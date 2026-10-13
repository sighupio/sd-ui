#!/usr/bin/env bash
# `mise run up`: create the Kind cluster, install the distribution from
# dev/kind/furyctl.yaml, and deploy the showcase workloads. Idempotent: re-running it
# converges an existing environment.
# Env: DEMO_APPS=false skips the showcase workloads; FURYCTL_DISTRO_LOCATION (see below).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

# `up` applies dev/kind/furyctl.yaml AS-IS: it is never rendered or overwritten here.
# Detect Capsule FROM that file (the single source of truth) and export it so every step
# matches what is actually installed: create-cluster (StorageClass label), generate-templates
# (users.ldif group), the Capsule-CA sync and deploy-demo-apps all key off it.
CAPSULE="$("$SCRIPT_DIR/detect-capsule.sh")"
export CAPSULE

echo "========================================="
echo "  sd-ui: Full Environment Setup (CAPSULE=$CAPSULE)"
echo "========================================="

echo ""
echo "[1/5] Creating Kind cluster..."
"$SCRIPT_DIR/create-cluster.sh"

echo ""
echo "[2/5] Installing SIGHUP Distribution..."
# FURYCTL_DISTRO_LOCATION (optional): apply from a local distribution checkout, e.g. to
# test an unreleased distribution branch.
furyctl apply --disable-analytics --outdir "$PROJECT_DIR" -c "$KIND_FURYCTL_CONFIG" \
  ${FURYCTL_DISTRO_LOCATION:+--distro-location "$FURYCTL_DISTRO_LOCATION"}
# The distribution renders headlamp/sd-spec only with its own Headlamp (not on Kind).
"$SCRIPT_DIR/apply-sd-spec.sh"

# Without Capsule, Headlamp talks to the in-cluster API server and needs no Capsule Proxy
# CA bundle.
echo ""
if [ "$CAPSULE" != "false" ]; then
  echo "[3/5] Syncing Capsule CA for Headlamp..."
  "$SCRIPT_DIR/sync-capsule-ca.sh"
else
  echo "[3/5] CAPSULE=false — skipping Capsule CA sync."
fi

# Dex, Pomerium and the Capsule Proxy may still be starting right after the apply: retry
# for up to 10 minutes, and show the last error if it never succeeds.
# DEMO_APPS=false skips them (they need several GiB of RAM).
echo ""
if [ "${DEMO_APPS:-true}" = "false" ]; then
  echo "[4/5] DEMO_APPS=false — skipping showcase workloads."
else
  echo "[4/5] Deploying showcase workloads..."
  max_attempts=60
  log="$(mktemp)"
  trap 'rm -f "$log"' EXIT
  for attempt in $(seq 1 "$max_attempts"); do
    if "$SCRIPT_DIR/deploy-demo-apps.sh" > "$log" 2>&1; then
      cat "$log"
      break
    fi
    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "[ERROR] Failed to deploy demo apps after 10 minutes. Last attempt:" >&2
      cat "$log" >&2
      exit 1
    fi
    echo "  Cluster not ready yet, retrying in 10s... ($attempt/$max_attempts)"
    sleep 10
  done
fi

# index-patterns-cronjob fires hourly and never on creation: without this the OSD deep
# links stay broken for up to an hour and the e2e checks cannot validate the OpenSearch
# queries deterministically. No-op on other logging flavors.
echo ""
echo "[5/5] Seeding OpenSearch Dashboards index patterns..."
"$SCRIPT_DIR/seed-opensearch-index-patterns.sh"

echo ""
echo "========================================="
echo "  Environment ready!"
echo ""
echo "  Run 'mise run dev' to start Tilt"
echo "  Then access Headlamp at:"
echo "  https://headlamp.$NIP_DOMAIN"
echo "========================================="
