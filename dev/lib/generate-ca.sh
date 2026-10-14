#!/usr/bin/env bash
# Generate a self-signed dev CA (ca.crt + ca.key, EC P-256, 10 years) unless one already
# exists. Shared by both dev environments:
#   Kind:        dev/kind/scripts/create-cluster.sh -> dev/kind/state/certs
#   OnPremises:  dev/onprem/scripts/vms-up.sh       -> dev/onprem/state/certs
#
# Usage: generate-ca.sh <output dir> <CA common name>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $(basename "$0") <output dir> <CA common name>" >&2
  exit 2
fi

CERTS_DIR="$1"
CA_CN="$2"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERTS_LABEL="${CERTS_DIR#"$PROJECT_DIR"/}"

if [ -f "$CERTS_DIR/ca.crt" ] && [ -f "$CERTS_DIR/ca.key" ]; then
  echo "[INFO] CA already exists in $CERTS_LABEL/, skipping generation"
  exit 0
fi

mkdir -p "$CERTS_DIR"
echo "[INFO] Generating dev CA ($CA_CN)..."
(
  umask 077
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -nodes -keyout "$CERTS_DIR/ca.key" -out "$CERTS_DIR/ca.crt" \
    -days 3650 -subj "/CN=$CA_CN" 2>/dev/null
)
# The certificate is public; only the key stays private.
chmod 644 "$CERTS_DIR/ca.crt"

echo "[SUCCESS] CA generated in $CERTS_LABEL/"
