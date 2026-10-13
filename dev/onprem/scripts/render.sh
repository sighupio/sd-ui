#!/bin/bash
# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Render dev/onprem/state/furyctl.yaml and everything it references under dev/onprem/state/:
# secrets (generated once), HAProxy additional config, LDAP plugin.
# Needs dev/onprem/state/ips.env (written by vms-up.sh, or by the render test).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../env.sh"

if [ -z "${ONPREM_LB_IP:-}" ] || [ -z "${ONPREM_CP_IP:-}" ] || [ -z "${ONPREM_W0_IP:-}" ]; then
  echo "[render] ERROR: VM IPs unknown ($STATE_DIR/ips.env): run 'mise run onprem:vms-up' first" >&2
  exit 1
fi

# Until a dev image is pushed (`mise run onprem:image`), deploy the released one.
: "${SD_UI_IMAGE_REPO:=registry.sighup.io/fury/sd-ui}"
: "${SD_UI_IMAGE_TAG:=v0.1.1}"
# LDAP group of the demo users, bound by the distribution to the sd-ui-reader role.
: "${SD_UI_GROUP:=sd-ui-users}"
export SD_UI_IMAGE_REPO SD_UI_IMAGE_TAG SD_UI_GROUP

mkdir -p "$STATE_DIR/secrets/pomerium" "$STATE_DIR/plugins"

# --- Secrets: generated once, kept across re-renders (changing them restarts the components) ---
gen_secret() {
  local file="$STATE_DIR/secrets/$1"
  shift
  if [ ! -s "$file" ]; then
    "$@" | tr -d '\n' > "$file"
    chmod 600 "$file"
  fi
}
gen_secret pomerium/cookie_secret.txt openssl rand -base64 32
gen_secret pomerium/shared_secret.txt openssl rand -base64 32
gen_secret pomerium/idp_client_secret.txt openssl rand -hex 24
gen_secret pomerium/signing_key.txt sh -c 'openssl ecparam -genkey -name prime256v1 -noout | base64'
gen_secret minio-password.txt openssl rand -hex 16
gen_secret haproxy-stats-password.txt openssl rand -hex 16

# --- Names: VM name + dashed IP, resolvable through nip.io (the cluster's dnsZone) ---
ONPREM_LB_NAME="$(onprem_node_name "$(onprem_lb_vm)" "$ONPREM_LB_IP")"
ONPREM_CP_NAME="$(onprem_node_name "$(onprem_cp_vm)" "$ONPREM_CP_IP")"
export ONPREM_LB_NAME ONPREM_CP_NAME

ONPREM_WORKER_HOSTS=""
HAPROXY_HTTP_SERVERS=""
HAPROXY_HTTPS_SERVERS=""
i=0
for vm in $(onprem_worker_vms); do
  ip_var="ONPREM_W${i}_IP"
  ip="${!ip_var}"
  if [ -z "$ip" ]; then
    echo "[render] ERROR: $ip_var missing in $STATE_DIR/ips.env (ONPREM_WORKERS=$ONPREM_WORKERS)" >&2
    exit 1
  fi
  ONPREM_WORKER_HOSTS+="          - name: $(onprem_node_name "$vm" "$ip")"$'\n'"            ip: $ip"$'\n'
  HAPROXY_HTTP_SERVERS+="    server $vm $ip:31080 check"$'\n'
  HAPROXY_HTTPS_SERVERS+="    server $vm $ip:31443 check"$'\n'
  i=$((i + 1))
done
# envsubst inserts the value as-is: drop the trailing newline, the template has its own.
ONPREM_WORKER_HOSTS="${ONPREM_WORKER_HOSTS%$'\n'}"
export ONPREM_WORKER_HOSTS

# --- HAProxy: 80/443 on the load balancer -> ingress-nginx NodePorts on the workers ---
cat > "$STATE_DIR/haproxy-additional.cfg" <<EOF
frontend ingress-http
    mode tcp
    bind *:80
    default_backend ingress-http

backend ingress-http
    mode tcp
${HAPROXY_HTTP_SERVERS}
frontend ingress-https
    mode tcp
    bind *:443
    default_backend ingress-https

backend ingress-https
    mode tcp
${HAPROXY_HTTPS_SERVERS}
EOF

# --- Demo LDAP server (Dex connector): users from users.ldif, member of $SD_UI_GROUP ---
LDAP_SRC="$PROJECT_DIR/dev/kind/plugins/kustomize/ldap-server"
LDAP_DST="$STATE_DIR/plugins/ldap-server"
mkdir -p "$LDAP_DST"
cp "$LDAP_SRC/all.yaml" "$LDAP_SRC/kustomization.yaml" "$LDAP_DST/"
# shellcheck disable=SC2016 # envsubst variable list, not a shell expansion
SD_LDAP_GROUP="$SD_UI_GROUP" envsubst '$SD_LDAP_GROUP' < "$LDAP_SRC/users.ldif.tpl" > "$LDAP_DST/users.ldif"

# --- furyctl config ---
export ONPREM_PKI_DIR="$STATE_DIR/pki" ONPREM_STATE_DIR="$STATE_DIR"
# Only these variables are substituted (envsubst variable list, not a shell expansion).
# shellcheck disable=SC2016
TEMPLATE_VARS='$ONPREM_DIR $ONPREM_STATE_DIR $ONPREM_PKI_DIR $ONPREM_SSH_USER $ONPREM_SSH_KEY
  $ONPREM_LB_NAME $ONPREM_LB_IP $ONPREM_CP_NAME $ONPREM_CP_IP $ONPREM_WORKER_HOSTS $ONPREM_DOMAIN
  $ONPREM_REGISTRY_PORT $SD_UI_GROUP $SD_UI_IMAGE_REPO $SD_UI_IMAGE_TAG'
envsubst "$TEMPLATE_VARS" < "$ONPREM_DIR/furyctl.yaml.tpl" > "$ONPREM_FURYCTL_CONFIG"

echo "[render] $ONPREM_FURYCTL_CONFIG (domain $ONPREM_DOMAIN, image $SD_UI_IMAGE_REPO:$SD_UI_IMAGE_TAG)"
