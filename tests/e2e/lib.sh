#!/usr/bin/env bash
# ============================================================================
# tests/e2e/lib.sh — shared helpers for SD-UI compatibility validation.
#
# These validations reproduce, over plain curl, the exact HTTP the Headlamp
# plugins make: authenticate as a Capsule tenant user (Dex/OIDC), then call
# the Capsule Proxy with `Authorization: Bearer <id-token>` — the same path
# Pomerium -> Headlamp -> Capsule Proxy uses at runtime.
#
# Provides:
#   render_furyctl [out]               render dev/kind/furyctl.yaml.tmpl (scenario from
#                                      env) -> out (default dev/kind/furyctl.yaml), clean
#   provision_cluster                  fresh-install the scenario (reuse if matching)
#   get_token                          fresh OIDC id-token for the tenant user
#   probe <api-path>                   curl the Capsule Proxy; sets PROBE_STATUS / PROBE_BODY_FILE
#   config_module_type <module>        modules.<module>.type as the plugin would read it
#   record <name> <ok|notok> <must|xfail> <detail>   assertion + report row
#   summary                            print totals; exit non-zero on FAIL/XPASS
#
# Assertion semantics (XFAIL model, chosen for CI/e2e reuse):
#   must  + ok     -> PASS   (green)
#   must  + notok  -> FAIL   (red;   suite fails)
#   xfail + notok  -> XFAIL  (amber; documents a known gap — suite stays green)
#   xfail + ok     -> XPASS  (amber; a known gap got fixed — UPDATE the matrix)
# ============================================================================
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$LIB_DIR/../.." && pwd)"

# shellcheck source=../../dev/kind/env.sh
source "$PROJECT_DIR/dev/kind/env.sh"

KIND_SCRIPTS="$KIND_DIR/scripts"
CA_CERT="$KIND_CA_DIR/ca.crt"
CAPSULE_PROXY="https://api.${NIP_DOMAIN}"
TMPL="$KIND_DIR/furyctl.yaml.tmpl"
RENDERED="$KIND_FURYCTL_CONFIG"
KUBECONFIG_CAPSULE="$KIND_CAPSULE_USER_DIR/kubeconfig"

# Probe transport:
#   headlamp (default) — through the real front door: Pomerium (session cookie)
#                        -> Headlamp (/clusters/main) -> Capsule Proxy. Exercises
#                        the full runtime path the plugins use.
#   direct             — straight to the Capsule Proxy with the tenant id-token
#                        (Headlamp-independent; faster, for backend-only checks).
PROBE_MODE="${PROBE_MODE:-headlamp}"
HEADLAMP_BASE="https://headlamp.${NIP_DOMAIN}/clusters/main"
POMERIUM_JAR="$KIND_CAPSULE_USER_DIR/pomerium-cookies.txt"

# Tenant user (overridable): alice / bob / carol all exist in the dev LDAP.
export CAPSULE_USER="${CAPSULE_USER:-alice}"
export CAPSULE_PASS="${CAPSULE_PASS:-alice}"

ID_TOKEN=""
PROBE_STATUS=""
PROBE_BODY_FILE=""
# Response bodies of every probe, removed when the sourcing shell exits.
_PROBE_TMP="$(mktemp -d)"
trap 'rm -rf "$_PROBE_TMP"' EXIT
# Set and read by the checks-*.sh criteria helpers (ok|notok).
# shellcheck disable=SC2034
CRIT=""

# Retry knobs, shared by all categories (backends need a scrape/ingest to warm up).
RETRIES="${RETRIES:-12}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"

# Report counters
_PASS=0; _FAIL=0; _XFAIL=0; _XPASS=0
declare -a _ROWS=()

_c() { # color helper: _c <color> <text>
  local col="$1"; shift
  case "$col" in
    green)  printf '\033[32m%s\033[0m' "$*";;
    red)    printf '\033[31m%s\033[0m' "$*";;
    amber)  printf '\033[33m%s\033[0m' "$*";;
    *)      printf '%s' "$*";;
  esac
}

# --- Render the furyctl config for the current scenario ----------------------
# Scenario comes from env (defaults = dev baseline):
#   MONITORING_TYPE (prometheus) · LOGGING_TYPE (loki) · LOGGING_OPENSEARCH_TYPE (single)
# Substitutes ONLY those vars (furyctl's `{env://...}` and Pomerium's
# `${pomerium.id_token}` are left intact), then strips the template header so
# the output is clean and comment-free.
render_furyctl() {
  local out="${1:-$RENDERED}"
  local mon="${MONITORING_TYPE:-prometheus}"
  local log="${LOGGING_TYPE:-loki}"
  local ost="${LOGGING_OPENSEARCH_TYPE:-single}"
  local pol="${POLICY_TYPE:-kyverno}"
  local cap="${CAPSULE:-true}"
  case "$mon" in none|prometheus|prometheusAgent|mimir) ;;
    *) echo "[ERROR] invalid MONITORING_TYPE '$mon' (none|prometheus|prometheusAgent|mimir)" >&2; return 1;; esac
  case "$log" in
    none|loki|opensearch) ;;
    customOutputs) echo "[ERROR] LOGGING_TYPE=customOutputs is not provisionable here (needs hand-written Output CRs, no queryable backend). See docs/SD_COMPATIBILITY.md." >&2; return 1;;
    *) echo "[ERROR] invalid LOGGING_TYPE '$log' (none|loki|opensearch)" >&2; return 1;; esac
  case "$ost" in single|triple) ;;
    *) echo "[ERROR] invalid LOGGING_OPENSEARCH_TYPE '$ost' (single|triple)" >&2; return 1;; esac
  case "$pol" in none|kyverno|gatekeeper) ;;
    *) echo "[ERROR] invalid POLICY_TYPE '$pol' (none|kyverno|gatekeeper)" >&2; return 1;; esac
  case "$cap" in true|false) ;;
    *) echo "[ERROR] invalid CAPSULE '$cap' (true|false)" >&2; return 1;; esac
  # envsubst the scenario vars, then strip the Capsule / monitoring marker blocks
  # (and all marker lines — so no `#` comment leaks), then strip the template header.
  # shellcheck disable=SC2016 # envsubst variable list, not a shell expansion
  MONITORING_TYPE="$mon" LOGGING_TYPE="$log" LOGGING_OPENSEARCH_TYPE="$ost" POLICY_TYPE="$pol" \
    envsubst '${MONITORING_TYPE} ${LOGGING_TYPE} ${LOGGING_OPENSEARCH_TYPE} ${POLICY_TYPE}' < "$TMPL" \
    | awk -v cap="$cap" -v mon="$mon" '
        /^#<capsule-only>/      { skip=(cap=="false"); next }
        /^#<\/capsule-only>/    { skip=0; next }
        /^#<no-capsule-only>/   { skip=(cap!="false"); next }
        /^#<\/no-capsule-only>/ { skip=0; next }
        /^#<monitoring-only>/   { skip=(mon=="none"); next }
        /^#<\/monitoring-only>/ { skip=0; next }
        skip { next }
        { print }' \
    | awk 'f{print; next} /^apiVersion:/{print "---"; print; f=1}' > "$out"
  echo "[render] monitoring=$mon logging=$log(os:$ost) policy=$pol capsule=$cap -> $out" >&2
}

# --- Obtain a fresh OIDC id-token for the tenant user (direct mode) ----------
get_token() {
  if [ "${SKIP_LOGIN:-0}" != "1" ]; then
    echo "[auth] logging in as ${CAPSULE_USER} via Dex/OIDC..." >&2
    CAPSULE_USER="$CAPSULE_USER" CAPSULE_PASS="$CAPSULE_PASS" \
      "$KIND_SCRIPTS/capsule-login.sh" >&2
  fi
  # Extract id-token from the kubeconfig the login script wrote.
  ID_TOKEN="$(kubectl --kubeconfig "$KUBECONFIG_CAPSULE" config view --raw \
    -o jsonpath='{.users[0].user.auth-provider.config.id-token}' 2>/dev/null || true)"
  if [ -z "$ID_TOKEN" ]; then
    echo "[ERROR] could not obtain an id-token (is the cluster up? did capsule-login succeed?)" >&2
    return 1
  fi
  echo "[auth] id-token acquired for ${CAPSULE_USER}" >&2
}

# --- Obtain a Pomerium session cookie (headlamp mode) ------------------------
get_pomerium_session() {
  if [ "${SKIP_LOGIN:-0}" = "1" ] && [ -s "$POMERIUM_JAR" ]; then
    echo "[auth] reusing existing Pomerium session (SKIP_LOGIN=1)" >&2
    return 0
  fi
  CAPSULE_USER="$CAPSULE_USER" CAPSULE_PASS="$CAPSULE_PASS" \
    "$KIND_SCRIPTS/pomerium-login.sh" >/dev/null
}

# --- Authenticate for the selected PROBE_MODE --------------------------------
auth_setup() {
  case "$PROBE_MODE" in
    headlamp) get_pomerium_session ;;
    direct)   get_token ;;
    *) echo "[ERROR] invalid PROBE_MODE '$PROBE_MODE' (headlamp|direct)" >&2; return 1 ;;
  esac
}

# --- Issue the plugin's HTTP the way the plugin would ------------------------
# probe <path> [method=GET] [json-body]
#   headlamp mode -> https://headlamp/clusters/main<path> with the Pomerium cookie
#   direct   mode -> https://api<path>                    with the tenant bearer
# Sets PROBE_STATUS (HTTP code, "000" on transport error) and PROBE_BODY_FILE.
probe() {
  local path="$1" method="${2:-GET}" body="${3:-}" url
  PROBE_BODY_FILE="$(mktemp "$_PROBE_TMP/body.XXXXXX")"
  local args=(-sS -o "$PROBE_BODY_FILE" -w '%{http_code}' --cacert "$CA_CERT" -X "$method")
  if [ "$PROBE_MODE" = "direct" ]; then
    args+=(-H "Authorization: Bearer ${ID_TOKEN}"); url="${CAPSULE_PROXY}${path}"
  else
    args+=(-b "$POMERIUM_JAR"); url="${HEADLAMP_BASE}${path}"
  fi
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  PROBE_STATUS="$(curl "${args[@]}" "$url" 2>/dev/null || echo "000")"
}

# --- modules.<module>.type as the plugin reads it (sd-spec) ------
# Fetches the headlamp/sd-spec ConfigMap through the Capsule
# Proxy (as the tenant user would) and extracts modules.<module>.type from its
# `info.json` key.
config_module_type() {
  probe "/api/v1/namespaces/headlamp/configmaps/sd-spec"
  if [ "$PROBE_STATUS" != "200" ]; then
    echo ""   # not readable -> plugin treats as "not enabled"
    return 0
  fi
  jq -r --arg m "$1" '(.data["info.json"] // "{}") | fromjson | .modules[$m].type // ""' \
    < "$PROBE_BODY_FILE" 2>/dev/null
}

# --- cluster provisioning (fresh-install-per-scenario) -----------------------
# Philosophy: test each scenario from a FRESH install. Provisioning renders the
# scenario's furyctl.yaml and compares it (a real file diff — both are clean)
# to the committed dev/kind/furyctl.yaml, the config the running cluster is
# assumed to use:
#   - identical  -> reuse the running cluster (or `up` if none is running)
#   - different  -> write it, tear down any running cluster (gated by
#                   APPROVE_DOWN / TTY prompt), then `up` a fresh one.

# Is a cluster reachable via the admin kubeconfig?
cluster_up() {
  kubectl --kubeconfig "$KUBECONFIG" --request-timeout=5s get --raw='/readyz' >/dev/null 2>&1
}

# Gate the destructive teardown behind explicit approval.
# APPROVE_DOWN=1 to allow non-interactively; otherwise prompt on a TTY; else refuse.
confirm_teardown() {
  if [ "${APPROVE_DOWN:-0}" = "1" ]; then return 0; fi
  if [ -t 0 ]; then
    local ans
    read -rp "[approve] A running cluster differs from the requested scenario; recreate it fresh? This DESTROYS the cluster. [y/N] " ans
    [[ "$ans" =~ ^[Yy] ]] && return 0
    return 1
  fi
  echo "[ERROR] A running cluster differs from the requested scenario; refusing to tear it down non-interactively." >&2
  echo "[ERROR] Re-run with APPROVE_DOWN=1 to allow the teardown." >&2
  return 1
}

# Is Headlamp already deployed?
headlamp_up() {
  kubectl --kubeconfig "$KUBECONFIG" --request-timeout=10s \
    -n headlamp get deploy headlamp >/dev/null 2>&1
}

# Deploy Headlamp the same way `mise run dev` does, but batch-mode: build the
# plugins into the image and apply the dev overlay via `tilt ci` (waits ready,
# exits). Skipped if already present, or if SKIP_HEADLAMP=1.
deploy_headlamp() {
  if [ "${SKIP_HEADLAMP:-0}" = "1" ]; then
    echo "[headlamp] SKIP_HEADLAMP=1 — not deploying."
    return 0
  fi
  if headlamp_up; then
    echo "[headlamp] already deployed — skipping (run 'tilt ci' to rebuild)."
    return 0
  fi
  # Warn-only: provisioning never aborts on a Headlamp problem. The hard gate is
  # at validate time — the `headlamp: front door + cluster proxy` must-check (and
  # the Pomerium login) fail the run when PROBE_MODE=headlamp; PROBE_MODE=direct
  # doesn't need Headlamp, so a warning is the right level there.
  echo "[headlamp] building plugins..."
  mise run plugins-build \
    || echo "[headlamp][WARN] plugins-build failed; Headlamp may not deploy (front-door check will fail hard in headlamp mode)." >&2
  echo "[headlamp] deploying via 'tilt ci' (build image + apply dev overlay)..."
  tilt ci \
    || echo "[headlamp][WARN] tilt ci failed; Headlamp not up (front-door check will fail hard in headlamp mode)." >&2
  return 0
}

# Ensure a fresh cluster for the current scenario (env-driven, see render_furyctl),
# then ensure Headlamp is deployed on top of it.
provision_cluster() {
  local desired; desired="$(mktemp)"
  if ! render_furyctl "$desired"; then rm -f "$desired"; return 1; fi
  if diff -q "$desired" "$RENDERED" >/dev/null 2>&1; then
    echo "[provision] scenario matches committed furyctl.yaml."
    if cluster_up; then
      echo "[provision] cluster already running that config — reusing it."
    else
      echo "[provision] no cluster running — creating one (mise run up)..."
      mise run up
    fi
  else
    echo "[provision] scenario differs from committed furyctl.yaml."
    if cluster_up; then
      if ! confirm_teardown; then rm -f "$desired"; return 1; fi
      echo "[provision] tearing down existing cluster..."
      mise run down
    fi
    cp "$desired" "$RENDERED"
    echo "[provision] updated dev/kind/furyctl.yaml with the scenario config."
    echo "[provision] creating fresh cluster (mise run up)..."
    mise run up
  fi
  rm -f "$desired"
  # `mise run up` already seeds these, but the reuse branch above skips `up` entirely — and
  # a cluster reused within its first hour has no index patterns yet, which would fail the
  # OSD checks. Idempotent, and a no-op on non-opensearch flavors.
  "$KIND_SCRIPTS/seed-opensearch-index-patterns.sh"
  # Same for the plugins' headlamp/sd-spec, which must match the scenario's config.
  "$KIND_SCRIPTS/apply-sd-spec.sh"
  deploy_headlamp
}

# --- Record one assertion ----------------------------------------------------
# record <name> <ok|notok> <must|xfail> <detail>
record() {
  local name="$1" ok="$2" mode="$3" detail="${4:-}"
  local verdict color
  if [ "$mode" = "must" ]; then
    if [ "$ok" = "ok" ]; then verdict="PASS"; color=green; _PASS=$((_PASS+1))
    else verdict="FAIL"; color=red; _FAIL=$((_FAIL+1)); fi
  else # xfail
    if [ "$ok" = "notok" ]; then verdict="XFAIL"; color=amber; _XFAIL=$((_XFAIL+1))
    else verdict="XPASS"; color=amber; _XPASS=$((_XPASS+1)); fi
  fi
  printf '  [%s] %-34s %s\n' "$(_c "$color" "$verdict")" "$name" "$detail"
  _ROWS+=("$verdict|$name|$detail")
}

# --- Final summary + exit code ----------------------------------------------
summary() {
  echo
  echo "──────────────────────────────────────────────────────────────"
  printf 'Summary: %s pass · %s fail · %s xfail · %s xpass\n' \
    "$(_c green "$_PASS")" "$(_c red "$_FAIL")" "$(_c amber "$_XFAIL")" "$(_c amber "$_XPASS")"
  if [ "$_XPASS" -gt 0 ]; then
    echo "$(_c amber 'NOTE'): XPASS means a documented gap now works — update docs/SD_COMPATIBILITY.md."
  fi
  echo "──────────────────────────────────────────────────────────────"
  # Fail the run on real failures OR on newly-fixed gaps (so the matrix stays honest).
  if [ "$_FAIL" -gt 0 ] || [ "$_XPASS" -gt 0 ]; then
    return 1
  fi
  return 0
}
