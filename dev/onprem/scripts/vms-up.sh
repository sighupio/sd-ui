#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Create/start the Lima VMs of the OnPremises dev environment (idempotent) and record their
# IPs in dev/onprem/state/ips.env.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

"$SCRIPT_DIR/preflight.sh" vms

mkdir -p "$STATE_DIR/ssh" "$STATE_DIR/lima"

# Dedicated SSH key: furyctl/Ansible log into the nodes by IP with it.
if [ ! -f "$ONPREM_SSH_KEY" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "sd-ui-onprem" -f "$ONPREM_SSH_KEY"
  echo "[vms] generated SSH key $ONPREM_SSH_KEY"
fi

# The environment's own CA: installed on the nodes (API server trusts Dex with it) and used
# by cert-manager to sign every ingress certificate.
"$PROJECT_DIR/dev/lib/generate-ca.sh" "$ONPREM_CA_DIR" "sd-ui-onprem-dev-ca"

export ONPREM_SSH_PUBKEY
ONPREM_SSH_PUBKEY="$(cat "$ONPREM_SSH_KEY.pub")"
export CA_B64
CA_B64="$(base64 < "$ONPREM_CA_DIR/ca.crt" | tr -d '\n')"

vm_status() {
  limactl list --format '{{.Status}}' "$1" 2>/dev/null || true
}

for vm in $(onprem_all_vms); do
  case "$vm" in
    *-lb0) LIMA_CPUS=$ONPREM_LB_CPUS LIMA_MEMORY_GIB=$ONPREM_LB_MEMORY_GIB LIMA_DISK_GIB=$ONPREM_LB_DISK_GIB ;;
    *-cp0) LIMA_CPUS=$ONPREM_CP_CPUS LIMA_MEMORY_GIB=$ONPREM_CP_MEMORY_GIB LIMA_DISK_GIB=$ONPREM_CP_DISK_GIB ;;
    *) LIMA_CPUS=$ONPREM_WORKER_CPUS LIMA_MEMORY_GIB=$ONPREM_WORKER_MEMORY_GIB LIMA_DISK_GIB=$ONPREM_WORKER_DISK_GIB ;;
  esac
  export LIMA_CPUS LIMA_MEMORY_GIB LIMA_DISK_GIB

  status="$(vm_status "$vm")"
  # VMs created before the switch to socket_vmnet sit on an isolated network.
  if [ -n "$status" ]; then
    vm_dir="$(limactl list --format '{{.Dir}}' "$vm")"
    if ! grep -qE '^ *- socket: ' "$vm_dir/lima.yaml"; then
      echo "[vms] ERROR: $vm was created with an older network setup (no socket_vmnet network)." >&2
      echo "[vms] Recreate the environment: mise run onprem:nuke && mise run onprem:up" >&2
      exit 1
    fi
  fi
  case "$status" in
    Running)
      echo "[vms] $vm already running"
      ;;
    Stopped)
      echo "[vms] starting $vm..."
      limactl start --tty=false "$vm"
      ;;
    "")
      # shellcheck disable=SC2016 # envsubst variable list, not a shell expansion
      envsubst '$LIMA_CPUS $LIMA_MEMORY_GIB $LIMA_DISK_GIB $ONPREM_SSH_USER $ONPREM_SOCKET_VMNET $CA_B64 $ONPREM_SSH_PUBKEY' \
        < "$ONPREM_DIR/lima/node.yaml.tpl" > "$STATE_DIR/lima/$vm.yaml"
      echo "[vms] creating $vm (${LIMA_CPUS} vCPU, ${LIMA_MEMORY_GIB} GiB RAM, ${LIMA_DISK_GIB} GiB disk)..."
      limactl start --tty=false --name="$vm" "$STATE_DIR/lima/$vm.yaml"
      ;;
    *)
      echo "[vms] ERROR: $vm is in state '$status'; inspect it with 'limactl list' or run 'mise run onprem:nuke'" >&2
      exit 1
      ;;
  esac
done

# IP of the shared-network interface (lima0): the address the Mac and the other VMs use.
vm_ip() {
  limactl shell "$1" -- ip -4 -o addr show dev lima0 | awk '{print $4}' | cut -d/ -f1
}

NEW_IPS="$STATE_DIR/ips.env.new"
{
  echo "ONPREM_LB_IP=$(vm_ip "$(onprem_lb_vm)")"
  echo "ONPREM_CP_IP=$(vm_ip "$(onprem_cp_vm)")"
  i=0
  for vm in $(onprem_worker_vms); do
    echo "ONPREM_W${i}_IP=$(vm_ip "$vm")"
    i=$((i + 1))
  done
} > "$NEW_IPS"

if grep -q '=$' "$NEW_IPS"; then
  echo "[vms] ERROR: could not read the lima0 IP of every VM:" >&2
  cat "$NEW_IPS" >&2
  rm -f "$NEW_IPS"
  exit 1
fi

# Node names, controlPlaneAddress and the domain all embed the IPs: if they changed, the
# cluster can't be reused.
if [ -f "$STATE_DIR/ips.env" ] && ! diff -q "$STATE_DIR/ips.env" "$NEW_IPS" >/dev/null; then
  echo "[vms] ERROR: VM IPs changed since the cluster was created (IP drift):" >&2
  diff "$STATE_DIR/ips.env" "$NEW_IPS" >&2 || true
  echo "[vms] Recreate the environment: mise run onprem:nuke && mise run onprem:up" >&2
  rm -f "$NEW_IPS"
  exit 1
fi
mv "$NEW_IPS" "$STATE_DIR/ips.env"
# shellcheck disable=SC1091
source "$STATE_DIR/ips.env"

# Checks: plain SSH by IP with the dedicated key (what furyctl does), and the Mac's registry
# alias resolvable from the guest.
for vm in $(onprem_all_vms); do
  ip="$(vm_ip "$vm")"
  ssh -i "$ONPREM_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 \
    "$ONPREM_SSH_USER@$ip" true ||
    { echo "[vms] ERROR: SSH to $ONPREM_SSH_USER@$ip ($vm) failed" >&2; exit 1; }
  limactl shell "$vm" -- getent hosts host.lima.internal >/dev/null ||
    { echo "[vms] ERROR: host.lima.internal does not resolve in $vm" >&2; exit 1; }
  echo "[vms] $vm: $ip (SSH OK)"
done
