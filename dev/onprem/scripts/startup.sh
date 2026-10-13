#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Bring up the OnPremises dev environment end to end (idempotent: re-running it converges).
# Usage: startup.sh [all|apply]
#   all   (default) VMs, registry, image, config, kubernetes + distribution + plugins phases
#   apply re-render the config and re-apply the distribution and plugins phases only
#
# FURYCTL_DISTRO_LOCATION (optional): apply from a local distribution checkout.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

MODE="${1:-all}"

# furyctl resolves a relative --distro-location against --workdir (the state dir), so
# make it absolute while we are still in the caller's directory.
if [[ -n "${FURYCTL_DISTRO_LOCATION:-}" ]]; then
  FURYCTL_DISTRO_LOCATION="$(cd "$FURYCTL_DISTRO_LOCATION" && pwd)"
fi

furyctl_apply() {
  # --workdir: furyctl writes the cluster kubeconfig to its working directory.
  furyctl apply --disable-analytics --workdir "$STATE_DIR" --outdir "$STATE_DIR" \
    -c "$ONPREM_FURYCTL_CONFIG" \
    ${FURYCTL_DISTRO_LOCATION:+--distro-location "$FURYCTL_DISTRO_LOCATION"} "$@"
}

kc() {
  kubectl --kubeconfig "$ONPREM_KUBECONFIG" "$@"
}

if [ "$MODE" = "all" ]; then
  echo "[1/7] Preflight, registry and VMs..."
  "$SCRIPT_DIR/registry.sh" up
  "$SCRIPT_DIR/vms-up.sh"
  source "$SCRIPT_DIR/../env.sh"

  echo "[2/7] SD-UI image..."
  if [ ! -f "$STATE_DIR/image.env" ]; then
    "$SCRIPT_DIR/image.sh"
    source "$SCRIPT_DIR/../env.sh"
  else
    echo "[image] using $SD_UI_IMAGE_REPO:$SD_UI_IMAGE_TAG (rebuild with 'mise run onprem:image')"
  fi
fi

echo "[3/7] Rendering the furyctl config..."
"$SCRIPT_DIR/preflight.sh" render
"$SCRIPT_DIR/render.sh"

if [ "$MODE" = "all" ]; then
  echo "[4/7] Kubernetes phase (control plane, workers, HAProxy load balancer)..."
  if [ ! -d "$STATE_DIR/pki" ]; then
    furyctl create pki --disable-analytics --path "$STATE_DIR/pki"
  fi
  furyctl_apply --phase kubernetes

  echo "[5/7] Storage and the CA keypair for cert-manager..."
  # OnPremises clusters ship without a StorageClass; logging, monitoring and dr need one.
  kc apply -k "$ONPREM_DIR/manifests/local-path"
  # Created before cert-manager exists, so the sd-ui-dev-ca ClusterIssuer works right away.
  kc create namespace cert-manager --dry-run=client -o yaml | kc apply -f -
  kc -n cert-manager create secret tls sd-ui-dev-ca-keypair \
    --cert="$ONPREM_CA_DIR/ca.crt" --key="$ONPREM_CA_DIR/ca.key" \
    --dry-run=client -o yaml | kc apply -f -
fi

echo "[6/7] Distribution phase..."
furyctl_apply --phase distribution

echo "[7/7] Plugins phase (CA issuer, demo LDAP)..."
furyctl_apply --phase plugins

cat <<EOF

=========================================
  OnPremises environment ready
  Headlamp (SD-UI): https://dashboard.${ONPREM_DOMAIN}
  Login (Dex/LDAP): alice/alice, bob/bob, carol/carol
  Trust the CA in your browser: ${ONPREM_CA_DIR}/ca.crt
  kubectl: eval "\$(mise run -q onprem:env)" or 'mise run onprem:kubectl -- get nodes'
=========================================
EOF
