#!/usr/bin/env bash
# ============================================================================
# checks-policy.sh — POLICY category checks (sourced by validate.sh).
#
# Defines checks_policy(); uses lib.sh's probe/record/CRIT/RETRIES.
#
# Plugins depending on modules.policy.type (detected as isKyverno/isGatekeeper):
#   • sd-policy / sd-core policy card
#       kyverno    -> lists wgpolicyk8s.io PolicyReport + ClusterPolicyReport
#       gatekeeper -> discovers constraints.gatekeeper.sh kinds, lists each,
#                     reads status.violations
#
# These are plain Kubernetes API list calls (not a service proxy). "Reachable"
# means the flavor's CRD/API group is installed and the tenant may list it —
# which is exactly what the plugin needs. Both flavors are supported (no gap).
#
# Expected per flavor (see docs/SD_COMPATIBILITY.md):
#   none       -> hidden; neither policy API group installed
#   kyverno    -> (Cluster)PolicyReport listable; reports produced
#   gatekeeper -> constraints.gatekeeper.sh discoverable; constraint kinds exist
# ============================================================================

_KYV_CPR="/apis/wgpolicyk8s.io/v1alpha2/clusterpolicyreports"
_KYV_PR="/apis/wgpolicyk8s.io/v1alpha2/policyreports"
_GK_API="/apis/constraints.gatekeeper.sh/v1beta1"

# API reachable: list endpoint returns 200 with a Kubernetes list envelope
# (has .items). Retried for the post-install warm-up (CRDs/aggregation).
_api_reachable() { # <path> [attempts=RETRIES]
  local path="$1" attempts="${2:-$RETRIES}" i
  for ((i=1; i<=attempts; i++)); do
    probe "$path"
    if [ "$PROBE_STATUS" = "200" ] && jq -e 'has("items") or has("resources")' < "$PROBE_BODY_FILE" >/dev/null 2>&1; then
      CRIT=ok; return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
  CRIT=notok
}

# data present: a jq count filter > 0, retried (policy engines scan in the background)
_api_has() { # <path> <jq-count-filter>
  local path="$1" filter="$2" i n
  CRIT=notok
  for ((i=1; i<=RETRIES; i++)); do
    probe "$path"
    if [ "$PROBE_STATUS" = "200" ]; then
      n="$(jq -r "$filter" < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
      if [ "${n:-0}" -gt 0 ] 2>/dev/null; then CRIT=ok; return; fi
    fi
    [ "$i" -lt "$RETRIES" ] && sleep "$RETRY_SLEEP"
  done
}

# kyverno reports present, counted the way the plugin merges them: namespaced
# PolicyReports (what a tenant actually sees, via Capsule) + cluster ones.
# Sets _POL_DETAIL with the counts.
_POL_DETAIL=""
_kyverno_reports_present() {
  local i pr cpr
  CRIT=notok
  for ((i=1; i<=RETRIES; i++)); do
    probe "$_KYV_PR";  pr="$(jq -r '.items|length' < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
    probe "$_KYV_CPR"; cpr="$(jq -r '.items|length' < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
    _POL_DETAIL="PolicyReports=${pr:-0} ClusterPolicyReports=${cpr:-0}"
    if [ "$(( ${pr:-0} + ${cpr:-0} ))" -gt 0 ] 2>/dev/null; then CRIT=ok; return; fi
    [ "$i" -lt "$RETRIES" ] && sleep "$RETRY_SLEEP"
  done
}

checks_policy() {
  local detected expected flavor ok
  detected="$(config_module_type policy)"
  expected="${EXPECTED_POLICY_TYPE:-}"

  if [ -n "$expected" ]; then
    flavor="$expected"
    [ "$detected" = "$expected" ] && ok=ok || ok=notok
    record "policy: detect type (=$expected)" "$ok" must "sd-spec reports '${detected:-<empty>}'"
  else
    flavor="${detected:-none}"
    echo "[info] policy: live flavor '${flavor}'"
  fi

  case "$flavor" in
    none)
      # Hidden: neither policy API group should be installed.
      _api_reachable "$_KYV_CPR" 1; [ "$CRIT" = "ok" ] && ok=notok || ok=ok
      record "policy: sd-policy hidden (kyverno absent)"    "$ok"   must  "clusterpolicyreports HTTP $PROBE_STATUS"
      _api_reachable "$_GK_API" 1;  [ "$CRIT" = "ok" ] && ok=notok || ok=ok
      record "policy: sd-policy hidden (gatekeeper absent)" "$ok"   must  "gatekeeper API HTTP $PROBE_STATUS"
      ;;
    kyverno)
      _api_reachable "$_KYV_CPR"
      record "policy: sd-policy clusterpolicyreports reachable" "$CRIT" must "HTTP $PROBE_STATUS"
      _api_reachable "$_KYV_PR"
      record "policy: sd-policy policyreports reachable"        "$CRIT" must "HTTP $PROBE_STATUS"
      _kyverno_reports_present
      record "policy: sd-policy+core reports present"           "$CRIT" must "$_POL_DETAIL"
      ;;
    gatekeeper)
      _api_reachable "$_GK_API"
      record "policy: sd-policy gatekeeper API reachable"       "$CRIT" must "HTTP $PROBE_STATUS"
      # constraint kinds discovered (the plugin iterates these); skip /status subresources
      _api_has "$_GK_API" '[.resources[]?|select(.name|contains("/")|not)]|length'
      record "policy: sd-policy+core constraint kinds present"  "$CRIT" must "HTTP $PROBE_STATUS, constraints.gatekeeper.sh kinds"
      ;;
    *)
      record "policy: unknown flavor '$flavor'"                 notok  must "unhandled policy.type"
      ;;
  esac
}
