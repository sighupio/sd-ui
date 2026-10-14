#!/usr/bin/env bash
# Deploy the showcase apps (dev/sample-apps: Online Boutique, Sock Shop, chaos-test,
# pod-killers). Idempotent.
#
# The apps are the same in both scenarios; only how they are applied differs:
#   Capsule     -> log in as the tenant user and create/own the namespaces through the
#                  Capsule Proxy, then apply as that user.
#   no Capsule  -> no tenant or proxy: create plain namespaces and apply as admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

# Exported by startup.sh; detected here too so `mise run demo-apps` works standalone.
CAPSULE="${CAPSULE:-$("$SCRIPT_DIR/detect-capsule.sh")}"

SAMPLE_APPS_DIR="$PROJECT_DIR/dev/sample-apps"
NAMESPACES=(shop sock-shop chaos-test)

if [ "$CAPSULE" != "false" ]; then
  echo "========================================="
  echo "  Demo Apps: Deploy to Capsule Tenant"
  echo "========================================="
  apply_kubeconfig="$KIND_CAPSULE_USER_DIR/kubeconfig"

  echo ""
  echo "[1/3] Authenticating as Capsule user via OIDC..."
  "$SCRIPT_DIR/capsule-login.sh"

  echo ""
  echo "[2/3] Creating namespaces via Capsule Proxy (so tenant owns them)..."
else
  echo "========================================="
  echo "  Demo Apps: Deploy (no Capsule, admin)"
  echo "========================================="
  apply_kubeconfig="$KUBECONFIG"

  echo ""
  echo "[1/3] CAPSULE=false — no tenant login needed."

  echo ""
  echo "[2/3] Creating plain namespaces (admin)..."
fi

# Re-applying an existing namespace can be denied to the tenant user: not fatal, the app
# apply below fails loudly if the namespace is really missing.
for ns in "${NAMESPACES[@]}"; do
  kubectl --kubeconfig="$apply_kubeconfig" create namespace "$ns" --dry-run=client -o yaml |
    kubectl --kubeconfig="$apply_kubeconfig" apply -f - >/dev/null 2>&1 ||
    echo "[WARN] could not create/update namespace $ns (may already exist)" >&2
done

echo ""
echo "[3/3] Deploying apps (Online Boutique + Sock Shop + chaos-test + pod-killers)..."
kustomize build "$SAMPLE_APPS_DIR" | kubectl --kubeconfig="$apply_kubeconfig" apply -f -

echo ""
echo "========================================="
echo "  Demo apps deployed!"
echo ""
echo "  Namespaces: ${NAMESPACES[*]}"
echo "========================================="
