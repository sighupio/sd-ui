#!/usr/bin/env bash
# Render every template of the Kind dev environment for the current NIP_DOMAIN, CA and
# secrets. Generates the CA and the secrets first if missing (both idempotent), so it is
# the only prerequisite of `furyctl apply`. Re-run it after an IP change (host-ip.txt).
#
# Outputs (all gitignored):
#   dev/kind/state/kind-config.yaml, dev/kind/state/auth-config.yaml   cluster creation
#   dev/kind/plugins/kustomize/{ldap-server,gangplank,capsule-proxy-ingress}/*  furyctl plugins
#   dev/kind/tilt/<overlay>/{kustomization,patch-ingress-host}.yaml    Tilt overlays
# The plugin and overlay outputs sit next to their templates because kustomize resolves
# files relative to the kustomization.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

"$PROJECT_DIR/dev/lib/generate-ca.sh" "$KIND_CA_DIR" "sd-ui-dev-ca"
"$SCRIPT_DIR/generate-secrets.sh"

# render <template> <output> [envsubst variable list]: without a list, every exported
# variable is substituted.
render() {
  local tpl="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  if [ "$#" -ge 3 ]; then
    envsubst "$3" < "$tpl" > "$out"
  else
    envsubst < "$tpl" > "$out"
  fi
}

CA_PEM_INDENTED="$(sed 's/^/      /' "$KIND_CA_DIR/ca.crt")"
CA_B64="$(base64 < "$KIND_CA_DIR/ca.crt" | tr -d '\n')"
GANGPLANK_CLIENT_SECRET="$(cat "$KIND_SECRETS_DIR/gangplank/client_secret.txt")"
GANGPLANK_SESSION_KEY="$(cat "$KIND_SECRETS_DIR/gangplank/session_key.txt")"
export CA_PEM_INDENTED CA_B64 GANGPLANK_CLIENT_SECRET GANGPLANK_SESSION_KEY

echo "[INFO] Generating templates with NIP_DOMAIN=$NIP_DOMAIN"

# Only the listed variables are substituted (envsubst variable lists, not shell expansions).
# shellcheck disable=SC2016
{
  render "$KIND_DIR/kind-config.yaml.tpl" "$KIND_STATE_DIR/kind-config.yaml" '$KIND_STATE_DIR $KIND_CLUSTER_NAME'
  render "$KIND_DIR/auth-config.yaml.tpl" "$KIND_STATE_DIR/auth-config.yaml" '$NIP_DOMAIN $CA_PEM_INDENTED'
}

# LDAP users/groups: the group name is scenario-dependent so the token's `groups` claim
# never carries capsule.clastix.io when Capsule is not installed. Detected from the
# furyctl config being applied (same signal as startup.sh), NOT from env.sh.
if [ "$("$SCRIPT_DIR/detect-capsule.sh")" = "false" ]; then
  SD_LDAP_GROUP="sd-ui-users"
else
  SD_LDAP_GROUP="capsule.clastix.io"
fi
export SD_LDAP_GROUP

PLUGINS_DIR="$KIND_DIR/plugins/kustomize"
# shellcheck disable=SC2016
render "$PLUGINS_DIR/ldap-server/users.ldif.tpl" "$PLUGINS_DIR/ldap-server/users.ldif" '$SD_LDAP_GROUP'
render "$PLUGINS_DIR/gangplank/gangplank.yml.tpl" "$PLUGINS_DIR/gangplank/gangplank.yml"
render "$PLUGINS_DIR/gangplank/ingress.yml.tpl" "$PLUGINS_DIR/gangplank/ingress.yml"
render "$PLUGINS_DIR/gangplank/oidc-trusted-ca.yml.tpl" "$PLUGINS_DIR/gangplank/oidc-trusted-ca.yml"
render "$PLUGINS_DIR/capsule-proxy-ingress/ingress.yml.tpl" "$PLUGINS_DIR/capsule-proxy-ingress/ingress.yml"

# Headlamp dev overlays: ingress host patch + the kustomize base they build on, both from
# the sighupio/module-utilities repository:
#   dev/kind/tilt/headlamp            -> examples/oidc-capsule  (Capsule)
#   dev/kind/tilt/headlamp-no-capsule -> katalog/headlamp       (no Capsule)
# The Tiltfile picks one by detecting Capsule; both are rendered.
#
# By default the bases are remote kustomize references pinned to SD_UI_MODULE_REF (the
# module-utilities version shipped by the targeted distribution).
# To develop against a local module-utilities checkout instead, set SD_UI_MODULE_PATH to
# its root, relative to the overlay directory (dev/kind/tilt/<overlay>/; kustomize rejects
# absolute bases), e.g. SD_UI_MODULE_PATH=../../../../../module-utilities for a checkout
# next to this repo. SD_UI_MODULE_REF is then ignored.
#
# Everything is overridable from the environment, so no edit is needed to try either.
: "${SD_UI_MODULE_REF:=v0.1.1}"
TILT_DIR="$KIND_DIR/tilt"
if [ -n "${SD_UI_MODULE_PATH:-}" ]; then
  case "$SD_UI_MODULE_PATH" in
    /*)
      echo "[ERROR] SD_UI_MODULE_PATH=$SD_UI_MODULE_PATH is absolute; kustomize only accepts paths relative to dev/kind/tilt/<overlay>/." >&2
      exit 1
      ;;
  esac
  for base in katalog/headlamp examples/oidc-capsule; do
    if [ ! -d "$TILT_DIR/headlamp/$SD_UI_MODULE_PATH/$base" ]; then
      echo "[ERROR] module-utilities $base not found under SD_UI_MODULE_PATH=$SD_UI_MODULE_PATH" >&2
      echo "[ERROR] (resolved from dev/kind/tilt/<overlay>/). Fix the path or unset it to use the remote ref." >&2
      exit 1
    fi
  done
  : "${SD_UI_KATALOG_BASE:=${SD_UI_MODULE_PATH}/katalog/headlamp}"
  : "${SD_UI_CAPSULE_BASE:=${SD_UI_MODULE_PATH}/examples/oidc-capsule}"
else
  SD_UI_MODULE_URL="https://github.com/sighupio/module-utilities"
  : "${SD_UI_KATALOG_BASE:=${SD_UI_MODULE_URL}//katalog/headlamp?ref=${SD_UI_MODULE_REF}}"
  : "${SD_UI_CAPSULE_BASE:=${SD_UI_MODULE_URL}//examples/oidc-capsule?ref=${SD_UI_MODULE_REF}}"
fi
export SD_UI_KATALOG_BASE SD_UI_CAPSULE_BASE
echo "[INFO] Headlamp bases: ${SD_UI_CAPSULE_BASE} (Capsule), ${SD_UI_KATALOG_BASE} (no Capsule)"

# shellcheck disable=SC2016
for overlay in "$TILT_DIR/headlamp" "$TILT_DIR/headlamp-no-capsule"; do
  render "$overlay/patch-ingress-host.yaml.tpl" "$overlay/patch-ingress-host.yaml" '$NIP_DOMAIN'
  render "$overlay/kustomization.yaml.tpl" "$overlay/kustomization.yaml" '$SD_UI_KATALOG_BASE $SD_UI_CAPSULE_BASE'
done

echo "[SUCCESS] Templates generated"
