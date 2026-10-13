#!/usr/bin/env bash
# ============================================================================
# validate.sh — SD-UI compatibility validation runner.
#
# Sources lib.sh + every checks-<category>.sh, logs in ONCE as the Capsule
# tenant user, runs each category's checks against the LIVE cluster (reproducing
# the plugins' exact HTTP over curl), and prints ONE aggregated PASS/FAIL/XFAIL/
# XPASS summary. Exits non-zero on any FAIL or XPASS.
#
# Scope which categories run with CATEGORIES (default: all).
# Assert the live flavor per category with EXPECTED_<CATEGORY>_TYPE.
# ============================================================================
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$LIB_DIR/lib.sh"
# shellcheck source=checks-monitoring.sh
source "$LIB_DIR/checks-monitoring.sh"
# shellcheck source=checks-logging.sh
source "$LIB_DIR/checks-logging.sh"
# shellcheck source=checks-policy.sh
source "$LIB_DIR/checks-policy.sh"

# Default = every category sourced above (auto-discovered from the checks_<name>
# functions), so a newly added category joins automatically. Override with e.g.
# CATEGORIES="monitoring policy" to run a subset.
if [ -z "${CATEGORIES:-}" ]; then
  CATEGORIES="$(declare -F | sed -n 's/^declare -f checks_//p' | sort | tr '\n' ' ')"
fi

echo "=============================================================="
echo " SD-UI compatibility validation · categories: $CATEGORIES"
echo " transport: PROBE_MODE=$PROBE_MODE"
echo "=============================================================="

auth_setup || exit 2

# In headlamp mode, assert the full front door works before per-category checks:
# Pomerium session -> Headlamp -> (Capsule Proxy | real apiserver) answering the cluster API.
if [ "$PROBE_MODE" = "headlamp" ]; then
  probe "/version"
  [ "$PROBE_STATUS" = "200" ] && ok=ok || ok=notok
  if [ "${CAPSULE:-true}" = "false" ]; then _back="apiserver+RBAC"; else _back="Capsule"; fi
  record "headlamp: front door + cluster proxy" "$ok" must "HTTP $PROBE_STATUS (Pomerium->Headlamp->${_back})"
fi

for cat in $CATEGORIES; do
  if ! declare -F "checks_${cat}" >/dev/null; then
    echo "[ERROR] no checks defined for category '$cat'" >&2
    record "$cat: category runner" notok must "no checks_${cat} function"
    continue
  fi
  echo
  echo "──── category: ${cat} ────"
  "checks_${cat}"
done

summary
