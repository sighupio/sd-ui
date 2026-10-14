#!/usr/bin/env bash
# Create the Kind cluster (ctlptl: cluster + local registry) with the OIDC
# AuthenticationConfiguration, wire the registry mirrors, and seed what furyctl needs before
# its first apply (cert-manager CA secret, Capsule StorageClass label). Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

for tool in ctlptl kind kubectl docker envsubst openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[ERROR] '$tool' not found. Run 'mise install' first." >&2
    exit 1
  fi
done

echo "[INFO] HOST_IP=$HOST_IP, NIP_DOMAIN=$NIP_DOMAIN"

"$SCRIPT_DIR/start-registry-cache.sh"
# CA, secrets, kind-config.yaml, auth-config.yaml and the plugin manifests.
"$SCRIPT_DIR/generate-templates.sh"

echo "[INFO] Creating Kind cluster with local registry..."
ctlptl apply -f "$KIND_STATE_DIR/kind-config.yaml"

echo "[INFO] Saving kubeconfig to ${KUBECONFIG#"$PROJECT_DIR"/}..."
mkdir -p "$(dirname "$KUBECONFIG")"
(umask 077 && kind get kubeconfig --name "$KIND_CLUSTER_NAME" > "$KUBECONFIG")

# Point containerd on every node at the registry mirrors (containerd v2 hosts.toml), when
# the registry cache is running. Format: <registry>=<upstream>=<mirror container>.
MIRRORS=(
  "docker.io=https://registry-1.docker.io=mirror-dockerio"
  "ghcr.io=https://ghcr.io=mirror-ghcr"
  "registry.k8s.io=https://registry.k8s.io=mirror-registryk8s"
  "registry.sighup.io=https://registry.sighup.io=mirror-sighup"
  "quay.io=https://quay.io=mirror-quay"
)
if docker ps --filter name=mirror-dockerio -q | grep -q .; then
  echo "[INFO] Configuring containerd registry mirrors..."
  for node in $(kind get nodes --name "$KIND_CLUSTER_NAME"); do
    for entry in "${MIRRORS[@]}"; do
      IFS='=' read -r registry upstream container <<< "$entry"
      docker exec "$node" mkdir -p "/etc/containerd/certs.d/$registry"
      printf 'server = "%s"\n\n[host."http://%s:5000"]\n  capabilities = ["pull", "resolve"]\n' \
        "$upstream" "$container" |
        docker exec -i "$node" tee "/etc/containerd/certs.d/$registry/hosts.toml" >/dev/null
    done
    docker exec "$node" systemctl restart containerd
  done
  echo "[INFO] Registry mirrors configured, containerd restarted"
fi

echo "[INFO] Waiting for the API server..."
for i in $(seq 1 30); do
  if kubectl get --raw='/readyz' --request-timeout=5s >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[ERROR] API server not ready after 2.5 minutes" >&2
    exit 1
  fi
  sleep 5
done
echo "[INFO] Nodes stay NotReady until furyctl installs the CNI"

echo "[INFO] Creating cert-manager CA secret..."
kubectl create namespace cert-manager --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret tls kind-ca-keypair -n cert-manager \
  --cert="$KIND_CA_DIR/ca.crt" --key="$KIND_CA_DIR/ca.key" \
  --dry-run=client -o yaml | kubectl apply -f -

# Capsule Proxy filters StorageClasses by this label (Capsule scenario only).
if [ "${CAPSULE:-$("$SCRIPT_DIR/detect-capsule.sh")}" != "false" ]; then
  echo "[INFO] Labeling StorageClass for Capsule Proxy..."
  kubectl label storageclass standard kubernetes.io/metadata.name=standard --overwrite
fi

echo "[SUCCESS] Cluster ready:"
kubectl get nodes -o wide
