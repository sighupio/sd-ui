#!/usr/bin/env bash
# `mise run down`: stop Tilt and delete the Kind cluster and its local registry. Keeps the
# registry cache (`mise run cache-down`) and dev/kind/state/ (`mise run clean`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

echo "[INFO] Tearing down dev environment..."

pkill -f "tilt up" 2>/dev/null || true

if [ -f "$KIND_STATE_DIR/kind-config.yaml" ]; then
  ctlptl delete -f "$KIND_STATE_DIR/kind-config.yaml" --ignore-not-found
else
  kind delete cluster --name "$KIND_CLUSTER_NAME"
fi

echo "[SUCCESS] Environment torn down"
