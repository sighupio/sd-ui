#!/usr/bin/env bash
# Start the pull-through registry mirrors (docker.io, ghcr.io, registry.k8s.io,
# registry.sighup.io, quay.io) on the `kind` Docker network. They survive cluster rebuilds;
# their cache lives in dev/kind/registry-cache/data/ (gitignored). Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

if docker ps --filter name=mirror-dockerio -q | grep -q .; then
  echo "[INFO] Registry mirrors already running"
  exit 0
fi

echo "[INFO] Starting registry mirror containers..."

if ! docker network inspect kind >/dev/null 2>&1; then
  docker network create kind >/dev/null
fi

docker compose -f "$KIND_DIR/registry-cache/docker-compose.yaml" up -d

echo "[SUCCESS] Registry mirrors running (docker.io, ghcr.io, registry.k8s.io, registry.sighup.io, quay.io)"
