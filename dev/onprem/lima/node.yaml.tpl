# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Lima template for one OnPremises cluster node. Rendered by dev/onprem/scripts/vms-up.sh
# (envsubst) into dev/onprem/state/lima/<vm>.yaml, then `limactl create`d.

# Apple Virtualization.framework: native arm64 speed on Apple Silicon (qemu would emulate).
vmType: vz
arch: aarch64

images:
  - location: "https://cloud-images.ubuntu.com/releases/noble/release-20260926/ubuntu-24.04-server-cloudimg-arm64.img"
    arch: aarch64
    digest: "sha256:1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55"

cpus: ${LIMA_CPUS}
memory: "${LIMA_MEMORY_GIB}GiB"
disk: "${LIMA_DISK_GIB}GiB"

# The VM is a cluster node, not a dev box: no host directories shared into it.
mounts: []

# The OnPremises installer installs and configures its own containerd.
containerd:
  system: false
  user: false

# Second NIC (lima0) on the socket_vmnet shared network (192.168.105.0/24): reachable from
# the Mac and from the other VMs. Lima connects to the daemon's socket ("unmanaged" mode), so
# it needs no sudoers entry. vzNAT is not used: it isolates the VMs from each other.
# The lower metric makes lima0 the default route, so the kubelet picks its IP as the node IP
# (eth0, Lima's user-mode NIC, has the same 192.168.5.15 address in every VM).
networks:
  - socket: "${ONPREM_SOCKET_VMNET}"
    metric: 100

# Lima forwards every port a guest listens on to the Mac's localhost by default: the nodes'
# 80/443/6443 would end up on the Mac. Ignore everything; the Mac reaches the VMs by IP.
portForwards:
  - guestIP: "0.0.0.0"
    guestPortRange: [1, 65535]
    ignore: true
  - guestIP: "127.0.0.1"
    guestPortRange: [1, 65535]
    ignore: true

# Login user for furyctl/Ansible (Lima gives it passwordless sudo).
user:
  name: ${ONPREM_SSH_USER}

ssh:
  # Don't copy the Mac's ~/.ssh/*.pub into the VM: access is via the dedicated key below.
  loadDotSSHPubKeys: false

provision:
  # Provision scripts run on every boot: both are idempotent.
  # Dev CA in the system trust store: the API server reads it (oidc.ca_file) to trust Dex.
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      echo "${CA_B64}" | base64 -d > /usr/local/share/ca-certificates/sd-ui-dev-ca.crt
      update-ca-certificates
  # Dedicated SSH key used by furyctl/Ansible to reach the node by IP.
  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.ssh
      chmod 700 ~/.ssh
      grep -qxF "${ONPREM_SSH_PUBKEY}" ~/.ssh/authorized_keys 2>/dev/null || echo "${ONPREM_SSH_PUBKEY}" >> ~/.ssh/authorized_keys
      chmod 600 ~/.ssh/authorized_keys
