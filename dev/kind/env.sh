#!/usr/bin/env bash
# Environment for the default Kind dev environment. Sourced, not executed: by mise
# (`[env]._.source` in the root mise.toml, so every `mise run` task sees it) and by every
# script in dev/kind/scripts/.
#
# HOST_IP comes from host-ip.txt at the repo root (gitignored, created by the developer):
# every hostname is <service>.<dashed-ip>.nip.io, so nip.io resolves it without any DNS server.
#
# NOTE: CAPSULE and SD_LDAP_GROUP are intentionally NOT set here. mise re-applies whatever
# this file exports to EVERY `mise run` task, which would clobber an explicit `CAPSULE=false`
# in the caller's environment. Instead:
#   - render_furyctl (tests/e2e) reads CAPSULE as the desired flavor (default true);
#   - the APPLY path (startup.sh, generate-templates.sh, deploy-demo-apps.sh, Tiltfile)
#     auto-detects Capsule from dev/kind/furyctl.yaml (scripts/detect-capsule.sh), which
#     stays the single source of truth for `mise run up`.

KIND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$KIND_DIR/../.." && pwd)"
# Everything generated (CA, secrets, rendered cluster config, kubeconfig, tenant login
# artifacts) lives here, gitignored. `mise run clean` deletes it.
KIND_STATE_DIR="$KIND_DIR/state"
KIND_CLUSTER_NAME="sd-ui"
export KIND_DIR PROJECT_DIR KIND_STATE_DIR KIND_CLUSTER_NAME

export KIND_CA_DIR="$KIND_STATE_DIR/certs"
export KIND_SECRETS_DIR="$KIND_STATE_DIR/secrets"
export KIND_CAPSULE_USER_DIR="$KIND_STATE_DIR/capsule-user"
export KIND_FURYCTL_CONFIG="$KIND_DIR/furyctl.yaml"
# Admin kubeconfig of the Kind cluster, written by create-cluster.sh. Exported here (and
# so by mise to every task) instead of in mise.toml [env], to keep a single definition.
export KUBECONFIG="$KIND_STATE_DIR/kubeconfig"

ip_file="$PROJECT_DIR/host-ip.txt"
if [ ! -f "$ip_file" ]; then
  detected_ip="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  {
    echo ""
    echo "========================================================"
    echo "  ERROR: host-ip.txt not found!"
    echo ""
    echo "  Create it with your machine's IP address:"
    echo ""
    echo "    echo '${detected_ip:-<YOUR_IP>}' > host-ip.txt"
    echo ""
    echo "  This file is gitignored. Required for nip.io DNS."
    echo "========================================================"
    echo ""
  } >&2
  unset ip_file detected_ip
  # Sourced (mise, scripts): return. Executed by mistake: exit.
  # shellcheck disable=SC2317
  return 1 2>/dev/null || exit 1
fi

HOST_IP="$(tr -d '[:space:]' < "$ip_file")"
NIP_DOMAIN="$(echo "$HOST_IP" | tr '.' '-').nip.io"
export HOST_IP NIP_DOMAIN
unset ip_file
