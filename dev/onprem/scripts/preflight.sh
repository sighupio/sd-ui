#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Fail fast if the machine can't run the OnPremises dev environment.
# Usage: preflight.sh [vms|render]
#   vms    (default) full check: Apple Silicon macOS + Lima + Docker + CLI tools
#   render only the tools needed to render/validate the config (works on any OS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

MODE="${1:-vms}"
# user.name in Lima templates requires Lima >= 1.0.
LIMA_MIN_VERSION="1.0.0"

fail() {
  echo "[preflight] ERROR: $*" >&2
  exit 1
}

version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

for tool in envsubst openssl ssh-keygen furyctl kubectl kustomize; do
  command -v "$tool" >/dev/null 2>&1 || fail "'$tool' not found (run 'mise install'; envsubst comes with gettext)"
done

case "$ONPREM_WORKERS" in
  1 | 2) ;;
  *) fail "ONPREM_WORKERS must be 1 or 2 (got '$ONPREM_WORKERS')" ;;
esac

if [ "$MODE" = "render" ]; then
  echo "[preflight] render tools OK"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] ||
  fail "the OnPremises VMs need macOS on Apple Silicon (got $(uname -s)/$(uname -m))"

command -v limactl >/dev/null 2>&1 || fail "'limactl' not found: brew install lima"
LIMA_VERSION="$(limactl --version | awk '{print $NF}')"
version_ge "$LIMA_VERSION" "$LIMA_MIN_VERSION" ||
  fail "Lima $LIMA_VERSION is too old, need >= $LIMA_MIN_VERSION: brew upgrade lima"

# The VMs' shared network: a root socket_vmnet daemon (Homebrew service) Lima connects to.
[ -S "$ONPREM_SOCKET_VMNET" ] ||
  fail "socket_vmnet socket $ONPREM_SOCKET_VMNET not found: brew install socket_vmnet && sudo brew services start socket_vmnet (or set ONPREM_SOCKET_VMNET)"

command -v docker >/dev/null 2>&1 || fail "'docker' not found (Docker Desktop or colima)"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not reachable (start Docker Desktop or 'colima start')"

echo "[preflight] OK: Lima $LIMA_VERSION, $ONPREM_WORKERS worker(s)"
