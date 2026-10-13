#!/usr/bin/env bash
# Give Headlamp the CAs it needs to talk to the Capsule Proxy: creates, in the headlamp
# namespace, headlamp-ca-bundle (Capsule Proxy CA + dev CA), kind-ca (dev CA alone) and a
# copy of the capsule-proxy secret. Run after `furyctl apply`, which installs Capsule.
# No-op (beyond creating the namespace) when Capsule is not installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

echo "[INFO] Syncing secrets to headlamp namespace..."

kubectl create namespace headlamp --dry-run=client -o yaml | kubectl apply -f -

# No Capsule (oidc-rbac mode): Headlamp talks straight to the API server and needs no
# Capsule Proxy CA bundle.
if ! kubectl get secret capsule-proxy -n capsule-system >/dev/null 2>&1; then
  echo "[INFO] Capsule not installed (no capsule-system/capsule-proxy secret) — skipping CA sync."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

kubectl get secret capsule-proxy -n capsule-system -o jsonpath='{.data.ca}' | base64 -d > "$tmp/capsule-ca.crt"
cat "$tmp/capsule-ca.crt" "$KIND_CA_DIR/ca.crt" > "$tmp/combined-ca.crt"

# Combined bundle, mounted in place of the ServiceAccount CA.
kubectl create secret generic headlamp-ca-bundle -n headlamp \
  --from-file=ca.crt="$tmp/combined-ca.crt" \
  --dry-run=client -o yaml | kubectl apply -f -

# Dev CA alone, for the init container.
kubectl create secret generic kind-ca -n headlamp \
  --from-file=ca.crt="$KIND_CA_DIR/ca.crt" \
  --dry-run=client -o yaml | kubectl apply -f -

# Copy of the capsule-proxy secret, kept for reference.
kubectl get secret capsule-proxy -n capsule-system -o json |
  jq '.metadata.namespace = "headlamp" | .metadata.name = "capsule-proxy-ca"
      | del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp,
            .metadata.annotations, .metadata.labels, .metadata.ownerReferences)' |
  kubectl apply -f -

echo "[SUCCESS] Secrets synced to headlamp namespace"
