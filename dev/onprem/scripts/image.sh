#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Build the SD-UI image from the plugins' dist/ (linux/arm64), push it to the local registry
# and point the OnPremises environment at it.
#   - the tag is unique per build: the Headlamp Deployment uses imagePullPolicy IfNotPresent;
#   - the tag is recorded in dev/onprem/state/image.env and the furyctl config re-rendered,
#     so the next `onprem:apply` keeps it;
#   - if the cluster is up, the running Deployment is updated right away (kubectl set image).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

missing=""
for dir in "$PROJECT_DIR"/plugins/sd-*/; do
  [ -f "$dir/dist/main.js" ] || missing+=" $(basename "$dir")"
done
if [ -n "$missing" ]; then
  echo "[image] ERROR: plugins without dist/main.js:$missing (run 'mise run plugins-build')" >&2
  exit 1
fi

"$SCRIPT_DIR/registry.sh" up

TAG="dev-$(date +%Y%m%d%H%M%S)"
PUSH_REF="localhost:${ONPREM_REGISTRY_PORT}/sd-ui:${TAG}"
docker buildx build --platform linux/arm64 -t "$PUSH_REF" --push "$PROJECT_DIR"

mkdir -p "$STATE_DIR"
cat > "$STATE_DIR/image.env" <<EOF
SD_UI_IMAGE_REPO=host.lima.internal:${ONPREM_REGISTRY_PORT}/sd-ui
SD_UI_IMAGE_TAG=${TAG}
EOF
# shellcheck disable=SC1091 # generated just above
source "$STATE_DIR/image.env"
echo "[image] pushed $PUSH_REF (pulled by the nodes as $SD_UI_IMAGE_REPO:$SD_UI_IMAGE_TAG)"

if [ -f "$STATE_DIR/ips.env" ]; then
  "$SCRIPT_DIR/render.sh"
fi

if [ -f "$ONPREM_KUBECONFIG" ] &&
  kubectl --kubeconfig "$ONPREM_KUBECONFIG" -n headlamp get deploy headlamp >/dev/null 2>&1; then
  kubectl --kubeconfig "$ONPREM_KUBECONFIG" -n headlamp set image deploy/headlamp \
    "headlamp=$SD_UI_IMAGE_REPO:$SD_UI_IMAGE_TAG"
  kubectl --kubeconfig "$ONPREM_KUBECONFIG" -n headlamp rollout status deploy/headlamp --timeout=5m
fi
