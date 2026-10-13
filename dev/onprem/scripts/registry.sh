#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Local image registry for the OnPremises dev environment.
# Usage: registry.sh up|down
#
# Published on the Mac's 127.0.0.1 only: the Lima VMs reach it as host.lima.internal, which
# Lima maps to the Mac's loopback, so the registry is never exposed on the network.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

case "${1:-}" in
  up)
    if [ -n "$(docker ps -q -f "name=^${ONPREM_REGISTRY_NAME}$")" ]; then
      echo "[registry] $ONPREM_REGISTRY_NAME already running on 127.0.0.1:$ONPREM_REGISTRY_PORT"
    elif [ -n "$(docker ps -aq -f "name=^${ONPREM_REGISTRY_NAME}$")" ]; then
      docker start "$ONPREM_REGISTRY_NAME" >/dev/null
      echo "[registry] started $ONPREM_REGISTRY_NAME on 127.0.0.1:$ONPREM_REGISTRY_PORT"
    else
      docker run -d --restart unless-stopped --name "$ONPREM_REGISTRY_NAME" \
        -p "127.0.0.1:${ONPREM_REGISTRY_PORT}:5000" registry:2 >/dev/null
      echo "[registry] created $ONPREM_REGISTRY_NAME on 127.0.0.1:$ONPREM_REGISTRY_PORT"
    fi
    ;;
  down)
    docker rm -f "$ONPREM_REGISTRY_NAME" >/dev/null 2>&1 || true
    echo "[registry] removed $ONPREM_REGISTRY_NAME"
    ;;
  *)
    echo "Usage: $0 up|down" >&2
    exit 1
    ;;
esac
