#!/usr/bin/env bash
# ============================================================================
# pomerium-login.sh — obtain a Pomerium session cookie for the tenant user, so
# curl can reach services THROUGH the real front door (Pomerium -> Headlamp ->
# Capsule Proxy), exactly as a browser does.
#
# Unlike capsule-login.sh (which talks to Dex directly via the gangplank client
# and exchanges a code for a k8s id_token), here the OIDC *client* is Pomerium:
# we just drive the browser flow with a cookie jar and let Pomerium's callback
# do the token exchange. The result we keep is the `_pomerium` session cookie.
#
# Flow (confirmed against the dev cluster):
#   GET https://headlamp.<domain>/         -> 302 pomerium.<domain>/.pomerium/sign_in
#     -> ... -> https://login.<domain>/auth/ldap/login   (Dex LDAP form, 200)
#   POST credentials -> [approval?] -> Pomerium callback (sets _pomerium) -> headlamp/
#
# Writes the cookie jar to dev/kind/state/capsule-user/pomerium-cookies.txt and prints its
# path. DEBUG=1 also keeps the Dex login page there when the form is not found.
# Env: CAPSULE_USER / CAPSULE_PASS (default alice/alice).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

CA_CERT="$KIND_CA_DIR/ca.crt"
JAR="$KIND_CAPSULE_USER_DIR/pomerium-cookies.txt"
HEADLAMP_URL="https://headlamp.${NIP_DOMAIN}/"
LDAP_USER="${CAPSULE_USER:-alice}"
LDAP_PASS="${CAPSULE_PASS:-alice}"

DBG_DIR="$(mktemp -d)"
trap 'rm -rf "$DBG_DIR"' EXIT

curl_() { curl -sS --cacert "$CA_CERT" -c "$JAR" -b "$JAR" "$@"; }
extract_attr() { echo "$2" | sed -n "s/.*${1}=\"\([^\"]*\)\".*/\1/p" | head -1 | sed 's/&amp;/\&/g'; }

mkdir -p "$(dirname "$JAR")"
(umask 077 && : > "$JAR")

echo "[pomerium] logging in as ${LDAP_USER} via Pomerium -> Dex/LDAP..." >&2

# 1) Follow Headlamp -> Pomerium sign_in -> Dex, landing on the LDAP login form.
LOGIN_PAGE="$(curl_ -L "$HEADLAMP_URL")"

# Dex connector-selection page (if more than one connector) — pick LDAP.
LDAP_LINK="$(echo "$LOGIN_PAGE" | sed -n 's/.*href="\(\/auth\/ldap[^"]*\)".*/\1/p' | head -1 | sed 's/&amp;/\&/g' || true)"
if [ -n "$LDAP_LINK" ] && ! echo "$LOGIN_PAGE" | grep -q 'name="password"'; then
  LOGIN_PAGE="$(curl_ -L "https://login.${NIP_DOMAIN}${LDAP_LINK}")"
fi

# 2) Parse and POST the login form.
LOGIN_ACTION="$(extract_attr "action" "$LOGIN_PAGE")"
if [ -z "$LOGIN_ACTION" ]; then
  echo "[ERROR] could not find the Dex login form action" >&2
  if [ -n "${DEBUG:-}" ]; then
    echo "$LOGIN_PAGE" > "$KIND_CAPSULE_USER_DIR/login.html"
    echo "[DEBUG] login page saved to $KIND_CAPSULE_USER_DIR/login.html" >&2
  fi
  exit 1
fi
if [[ "$LOGIN_ACTION" == /* ]]; then LOGIN_ACTION="https://login.${NIP_DOMAIN}${LOGIN_ACTION}"; fi

curl_ -D "$DBG_DIR/h1.txt" -o "$DBG_DIR/b1.html" \
  --data-urlencode "login=${LDAP_USER}" --data-urlencode "password=${LDAP_PASS}" \
  "$LOGIN_ACTION"

LOCATION="$(grep -i '^location:' "$DBG_DIR/h1.txt" | tail -1 | tr -d '\r\n' | awk '{print $2}' || true)"
BODY="$(cat "$DBG_DIR/b1.html" 2>/dev/null || true)"

# 3) Dex approval/consent page (first login for the Pomerium client).
if echo "$BODY" | grep -q 'name="approval"'; then
  APPROVAL_ACTION="$(extract_attr "action" "$BODY")"
  if [[ "$APPROVAL_ACTION" == /* ]]; then APPROVAL_ACTION="https://login.${NIP_DOMAIN}${APPROVAL_ACTION}"; fi
  REQ_VALUE="$(echo "$BODY" | sed -n 's/.*name="req" value="\([^"]*\)".*/\1/p' | head -1)"
  LOCATION="$(curl_ -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "req=${REQ_VALUE}" --data-urlencode "approval=approve" "$APPROVAL_ACTION")"
fi

# 4) Follow the callback chain (Dex -> Pomerium callback sets _pomerium -> Headlamp).
if [ -n "$LOCATION" ]; then
  curl_ -L -o /dev/null "$LOCATION"
fi

# 5) Verify the session works through Headlamp's cluster proxy.
CODE="$(curl -sS --cacert "$CA_CERT" -b "$JAR" -o /dev/null -w '%{http_code}' \
  "https://headlamp.${NIP_DOMAIN}/clusters/main/version" || echo 000)"
if [ "$CODE" != "200" ]; then
  echo "[ERROR] Pomerium session not established (/clusters/main/version -> HTTP $CODE)" >&2
  exit 1
fi

echo "[pomerium] session established for ${LDAP_USER} (cookie jar: $JAR)" >&2
echo "$JAR"
