#!/usr/bin/env bash
# Generate the per-machine secrets of the Kind dev environment into $KIND_SECRETS_DIR
# (dev/kind/state/secrets/, gitignored). Each file is generated once and kept afterwards:
# changing a secret restarts the components that use it, so a re-run never rotates them.
# `mise run clean` deletes them together with the rest of dev/kind/state/.
#
# Consumers:
#   pomerium/*                 dev/kind/furyctl.yaml ({file://...}, auth module)
#   gangplank/client_secret    dev/kind/furyctl.yaml (Dex static client), gangplank.yml,
#                              capsule-login.sh (same OIDC client)
#   gangplank/session_key      gangplank.yml (session cookie signing key)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

# gen_secret <relative path> <command...>: write the command's output (no trailing
# newline, mode 600) unless the file already has content.
gen_secret() {
  local file="$KIND_SECRETS_DIR/$1"
  shift
  [ -s "$file" ] && return 0
  mkdir -p "$(dirname "$file")"
  (umask 077 && "$@" | tr -d '\n' > "$file")
  echo "[INFO] Generated ${file#"$PROJECT_DIR"/}"
}

gen_secret pomerium/cookie_secret.txt openssl rand -base64 32
gen_secret pomerium/shared_secret.txt openssl rand -base64 32
gen_secret pomerium/idp_client_secret.txt openssl rand -hex 24
gen_secret pomerium/signing_key.txt sh -c 'openssl ecparam -genkey -name prime256v1 -noout | base64'
gen_secret gangplank/client_secret.txt openssl rand -hex 24
gen_secret gangplank/session_key.txt openssl rand -base64 32
