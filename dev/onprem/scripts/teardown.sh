#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Stop or destroy the OnPremises dev environment.
# Usage: teardown.sh [--nuke]
#   (default) stop the VMs, keeping their disks: `mise run onprem:up` starts them again
#   --nuke    delete the VMs, the registry and dev/onprem/state/ (keys, CA, PKI, secrets,
#             kubeconfig): the next `mise run onprem:up` builds everything from scratch
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

vm_exists() {
  limactl list -q 2>/dev/null | grep -qx "$1"
}

if [ "${1:-}" = "--nuke" ]; then
  for vm in $(onprem_all_vms); do
    if vm_exists "$vm"; then
      limactl delete --force "$vm"
    fi
  done
  "$SCRIPT_DIR/registry.sh" down
  rm -rf "$STATE_DIR"
  echo "[teardown] OnPremises environment deleted"
else
  for vm in $(onprem_all_vms); do
    if vm_exists "$vm"; then
      limactl stop "$vm" || true
    fi
  done
  echo "[teardown] VMs stopped (disks kept); 'mise run onprem:nuke' deletes everything"
fi
