#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Environment for the OnPremises dev environment (Lima VMs). Sourced, not executed, by every
# script in dev/onprem/scripts/.
#
# The global mise [env] (KUBECONFIG, NIP_DOMAIN, ...) belongs to the default dev environment,
# and mise shims re-apply it to every tool they launch, overriding what a script exported.
# So this environment uses its own names (ONPREM_DOMAIN, ONPREM_KUBECONFIG) and the scripts
# always pass --kubeconfig explicitly.
#
# Every ONPREM_* value below is a default: set it in the caller's environment to override it.

ONPREM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$ONPREM_DIR/../.." && pwd)"
# Everything generated (VM IPs, keys, CA, secrets, rendered config, kubeconfig, PKI) lives
# here (gitignored). Overridable, e.g. by the render test.
STATE_DIR="${ONPREM_STATE_DIR:-$ONPREM_DIR/state}"
export ONPREM_DIR PROJECT_DIR STATE_DIR

# Lima VMs: one HAProxy load balancer, one control plane and ONPREM_WORKERS workers (1 or 2),
# named <prefix>-lb0, <prefix>-cp0, <prefix>-w0...
: "${ONPREM_VM_PREFIX:=sdui}"
: "${ONPREM_WORKERS:=1}"
: "${ONPREM_LB_CPUS:=1}"
: "${ONPREM_LB_MEMORY_GIB:=1}"
: "${ONPREM_LB_DISK_GIB:=10}"
: "${ONPREM_CP_CPUS:=2}"
: "${ONPREM_CP_MEMORY_GIB:=4}"
: "${ONPREM_CP_DISK_GIB:=30}"
: "${ONPREM_WORKER_CPUS:=6}"
: "${ONPREM_WORKER_MEMORY_GIB:=10}"
: "${ONPREM_WORKER_DISK_GIB:=80}"
# Socket of the socket_vmnet daemon (Homebrew service, started once with
# `sudo brew services start socket_vmnet`): the VMs' shared network, reachable from the Mac
# and between VMs. Lima only connects to it (unmanaged mode: no Lima sudoers entry).
: "${ONPREM_SOCKET_VMNET:=/opt/homebrew/var/run/socket_vmnet}"
# User furyctl/Ansible log in as (created by Lima, passwordless sudo).
: "${ONPREM_SSH_USER:=sdui}"
# Local registry on the Mac (127.0.0.1 only), reached from the VMs as host.lima.internal.
: "${ONPREM_REGISTRY_NAME:=sd-ui-onprem-registry}"
: "${ONPREM_REGISTRY_PORT:=5001}"
export ONPREM_VM_PREFIX ONPREM_WORKERS ONPREM_SSH_USER ONPREM_REGISTRY_NAME ONPREM_REGISTRY_PORT \
  ONPREM_SOCKET_VMNET \
  ONPREM_LB_CPUS ONPREM_LB_MEMORY_GIB ONPREM_LB_DISK_GIB \
  ONPREM_CP_CPUS ONPREM_CP_MEMORY_GIB ONPREM_CP_DISK_GIB \
  ONPREM_WORKER_CPUS ONPREM_WORKER_MEMORY_GIB ONPREM_WORKER_DISK_GIB

export ONPREM_SSH_KEY="$STATE_DIR/ssh/id_ed25519"
export ONPREM_CA_DIR="$STATE_DIR/certs"
export ONPREM_KUBECONFIG="$STATE_DIR/kubeconfig"
export ONPREM_FURYCTL_CONFIG="$STATE_DIR/furyctl.yaml"

# VM IPs discovered by vms-up.sh (ONPREM_LB_IP, ONPREM_CP_IP, ONPREM_W0_IP, ONPREM_W1_IP...).
if [ -f "$STATE_DIR/ips.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$STATE_DIR/ips.env"
  set +a
fi
# Dev image pushed by image.sh (SD_UI_IMAGE_REPO, SD_UI_IMAGE_TAG).
if [ -f "$STATE_DIR/image.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$STATE_DIR/image.env"
  set +a
fi

# The load balancer forwards 80/443 to the ingress NodePorts on the workers and 6443 to the
# API server: every hostname (dashboard., login., pomerium.) points at it.
if [ -n "${ONPREM_LB_IP:-}" ]; then
  ONPREM_DOMAIN="$(echo "$ONPREM_LB_IP" | tr '.' '-').nip.io"
else
  ONPREM_DOMAIN=""
fi
export ONPREM_DOMAIN

# VM name helpers.
onprem_lb_vm() { echo "${ONPREM_VM_PREFIX}-lb0"; }
onprem_cp_vm() { echo "${ONPREM_VM_PREFIX}-cp0"; }
onprem_worker_vms() {
  local i
  for ((i = 0; i < ONPREM_WORKERS; i++)); do echo "${ONPREM_VM_PREFIX}-w${i}"; done
}
onprem_all_vms() {
  onprem_lb_vm
  onprem_cp_vm
  onprem_worker_vms
}
# Kubernetes node name: VM name + dashed IP, resolvable through nip.io (dnsZone).
onprem_node_name() { echo "$1-$(echo "$2" | tr '.' '-')"; }
