#!/usr/bin/env bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Render the OnPremises furyctl config with fake VM IPs into a temporary state dir and check
# it: no VMs, no cluster, runs on any OS. Validates against the distribution schema with
# `furyctl validate config` (FURYCTL_DISTRO_LOCATION, if set, points it at a local checkout).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ONPREM_DIR="$PROJECT_DIR/dev/onprem"

# furyctl resolves a relative --distro-location against --workdir (a temp dir here), so
# make it absolute while we are still in the caller's directory.
if [[ -n "${FURYCTL_DISTRO_LOCATION:-}" ]]; then
  FURYCTL_DISTRO_LOCATION="$(cd "$FURYCTL_DISTRO_LOCATION" && pwd)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILURES=0
pass() { echo "  PASS $*"; }
fail() {
  echo "  FAIL $*"
  FAILURES=$((FAILURES + 1))
}
expect_grep() {
  local desc="$1" pattern="$2" file="$3"
  if grep -qE -- "$pattern" "$file"; then pass "$desc"; else fail "$desc (pattern: $pattern)"; fi
}
expect_no_grep() {
  local desc="$1" pattern="$2" file="$3"
  if grep -qiE -- "$pattern" "$file"; then
    fail "$desc (found: $(grep -niE -- "$pattern" "$file" | head -3 | tr '\n' ' '))"
  else
    pass "$desc"
  fi
}
expect_count() {
  local desc="$1" pattern="$2" file="$3" want="$4" got
  got="$(grep -cE -- "$pattern" "$file" || true)"
  if [ "$got" = "$want" ]; then pass "$desc"; else fail "$desc (want $want, got $got)"; fi
}

render_case() {
  local workers="$1" state="$TMP/state-$1"
  mkdir -p "$state"
  {
    echo "ONPREM_LB_IP=192.168.64.2"
    echo "ONPREM_CP_IP=192.168.64.3"
    echo "ONPREM_W0_IP=192.168.64.4"
    [ "$workers" = 2 ] && echo "ONPREM_W1_IP=192.168.64.5"
  } > "$state/ips.env"
  "$PROJECT_DIR/dev/lib/generate-ca.sh" "$state/certs" "render-test-ca" >/dev/null
  ONPREM_STATE_DIR="$state" ONPREM_WORKERS="$workers" bash "$ONPREM_DIR/scripts/render.sh" >/dev/null
  echo "$state"
}

echo "== workers=1"
STATE="$(render_case 1)"
CFG="$STATE/furyctl.yaml"
expect_no_grep "no unrendered variables" '\$\{' "$CFG"
expect_grep "kind OnPremises" '^kind: OnPremises$' "$CFG"
expect_grep "controlPlaneAddress on the load balancer" 'controlPlaneAddress: sdui-lb0-192-168-64-2\.nip\.io:6443' "$CFG"
expect_grep "domain on the load balancer IP" 'baseDomain: 192-168-64-2\.nip\.io' "$CFG"
expect_grep "OIDC issuer" 'issuer_url: https://login\.192-168-64-2\.nip\.io' "$CFG"
expect_grep "OIDC client_id pomerium" 'client_id: pomerium' "$CFG"
expect_grep "OIDC empty username prefix" 'username_prefix: "-"' "$CFG"
if grep -A1 -E '^        headlamp:$' "$CFG" | grep -qE '^          type: sso$'; then
  pass "utilities headlamp sso"
else
  fail "utilities headlamp sso"
fi
expect_grep "utilities oidcGroup" 'oidcGroup: sd-ui-users' "$CFG"
expect_grep "released image before any dev build" 'newTag: v0\.1\.1' "$CFG"
expect_grep "ingress issuer sd-ui-dev-ca" 'value: sd-ui-dev-ca' "$CFG"
expect_grep "registry mirror" 'http://host\.lima\.internal:5001' "$CFG"
# The furyctl preflight/kubernetes templates read these even with keepalived disabled
# (`furyctl validate config` doesn't catch their absence).
for field in interface ip virtualRouterId passphrase; do
  if grep -A8 -E '^      keepalived:$' "$CFG" | grep -qE "^        ${field}: "; then
    pass "keepalived.$field set"
  else
    fail "keepalived.$field missing"
  fi
done
expect_count "one worker host" '^          - name: sdui-w[0-9]-' "$CFG" 1
expect_count "one HAProxy https backend" ':31443 check' "$STATE/haproxy-additional.cfg" 1
expect_no_grep "no Capsule" 'capsule' "$CFG"
expect_no_grep "no references to the default environment" 'kind-ca|host-ip|dev/kind' "$CFG"
expect_grep "LDAP demo group" '^cn: sd-ui-users$' "$STATE/plugins/ldap-server/users.ldif"
for secret in pomerium/cookie_secret.txt pomerium/shared_secret.txt pomerium/idp_client_secret.txt \
  pomerium/signing_key.txt minio-password.txt haproxy-stats-password.txt; do
  if [ -s "$STATE/secrets/$secret" ]; then pass "secret $secret"; else fail "secret $secret missing"; fi
done

echo "== secrets are kept across renders"
before="$(cat "$STATE/secrets/pomerium/cookie_secret.txt")"
ONPREM_STATE_DIR="$STATE" bash "$ONPREM_DIR/scripts/render.sh" >/dev/null
if [ "$before" = "$(cat "$STATE/secrets/pomerium/cookie_secret.txt")" ]; then pass "cookie secret unchanged"; else fail "cookie secret regenerated"; fi

echo "== dev image override"
printf 'SD_UI_IMAGE_REPO=host.lima.internal:5001/sd-ui\nSD_UI_IMAGE_TAG=dev-20260101000000\n' > "$STATE/image.env"
ONPREM_STATE_DIR="$STATE" bash "$ONPREM_DIR/scripts/render.sh" >/dev/null
expect_grep "dev image repo" 'newName: host\.lima\.internal:5001/sd-ui' "$CFG"
expect_grep "dev image tag" 'newTag: dev-20260101000000' "$CFG"

echo "== workers=2"
STATE2="$(render_case 2)"
expect_count "two worker hosts" '^          - name: sdui-w[0-9]-' "$STATE2/furyctl.yaml" 2
expect_count "two HAProxy https backends" ':31443 check' "$STATE2/haproxy-additional.cfg" 2

echo "== Lima template"
# shellcheck disable=SC2016 # envsubst variable list, not a shell expansion
LIMA_CPUS=2 LIMA_MEMORY_GIB=4 LIMA_DISK_GIB=30 ONPREM_SSH_USER=sdui \
  ONPREM_SOCKET_VMNET=/opt/homebrew/var/run/socket_vmnet CA_B64=Q0EK \
  ONPREM_SSH_PUBKEY="ssh-ed25519 AAAA render-test" \
  envsubst '$LIMA_CPUS $LIMA_MEMORY_GIB $LIMA_DISK_GIB $ONPREM_SSH_USER $ONPREM_SOCKET_VMNET $CA_B64 $ONPREM_SSH_PUBKEY' \
  < "$ONPREM_DIR/lima/node.yaml.tpl" > "$TMP/lima.yaml"
expect_no_grep "no unrendered variables" '\$\{' "$TMP/lima.yaml"
expect_grep "shared network via socket_vmnet" '^  - socket: "/opt/homebrew/var/run/socket_vmnet"$' "$TMP/lima.yaml"
expect_no_grep "no vzNAT network (isolates the VMs)" '^ *- vzNAT:' "$TMP/lima.yaml"

echo "== kustomize build"
for dir in "$ONPREM_DIR/manifests/dev-ca-issuer" "$ONPREM_DIR/manifests/local-path" "$STATE/plugins/ldap-server"; do
  if kustomize build "$dir" >/dev/null 2>"$TMP/kustomize.err"; then
    pass "kustomize build ${dir#"$PROJECT_DIR"/}"
  else
    fail "kustomize build $dir: $(tail -1 "$TMP/kustomize.err")"
  fi
done

echo "== furyctl validate config"
furyctl create pki --disable-analytics --path "$STATE/pki" >/dev/null 2>&1
if furyctl validate config --disable-analytics --workdir "$TMP" --outdir "$TMP" -c "$CFG" \
  ${FURYCTL_DISTRO_LOCATION:+--distro-location "$FURYCTL_DISTRO_LOCATION"} >"$TMP/validate.log" 2>&1; then
  pass "furyctl validate config"
else
  fail "furyctl validate config: $(grep -E 'ERRO' "$TMP/validate.log" | head -2 | tr '\n' ' ')"
  echo "       (unreleased distribution? set FURYCTL_DISTRO_LOCATION to a local checkout)"
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "render-test: $FAILURES failure(s)"
  exit 1
fi
echo "render-test: all checks passed"
