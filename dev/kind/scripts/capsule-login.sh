#!/usr/bin/env bash
# Log in as the Capsule tenant user through Dex (LDAP connector) with the gangplank OIDC
# client, exchange the code for tokens, and write a kubeconfig pointing at the Capsule Proxy
# to dev/kind/state/capsule-user/kubeconfig.
# Env: CAPSULE_USER / CAPSULE_PASS (default alice/alice).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

# Fail early on a missing or unusable tool (e.g. an x86_64 jq without Rosetta): the token
# parsing below treats any jq failure as "no tokens".
for tool in curl jq python3; do
  if ! "$tool" --version >/dev/null 2>&1; then
    echo "[ERROR] '$tool' not found or not runnable. Run 'mise install' first." >&2
    exit 1
  fi
done

CA_CERT="$KIND_CA_DIR/ca.crt"
OUTPUT_KUBECONFIG="$KIND_CAPSULE_USER_DIR/kubeconfig"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
COOKIE_JAR="$WORK_DIR/cookies.txt"

# OIDC parameters (from gangplank config)
CLIENT_ID="oidc-auth-client"
CLIENT_SECRET="$(cat "$KIND_SECRETS_DIR/gangplank/client_secret.txt")"
REDIRECT_URI="https://gangplank.${NIP_DOMAIN}/callback"
AUTH_URL="https://login.${NIP_DOMAIN}/auth"
TOKEN_URL="https://login.${NIP_DOMAIN}/token"
SCOPES="openid profile email offline_access groups"
CAPSULE_PROXY="https://api.${NIP_DOMAIN}"

LDAP_USER="${CAPSULE_USER:-alice}"
LDAP_PASS="${CAPSULE_PASS:-alice}"

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

# Extract attribute value from HTML: extract_attr 'action' "$HTML"
extract_attr() {
  local attr="$1"
  echo "$2" | sed -n "s/.*${attr}=\"\([^\"]*\)\".*/\1/p" | head -1 | sed 's/&amp;/\&/g'
}

echo "[INFO] Logging in as ${LDAP_USER} via Dex OIDC..."

# Step 1: GET auth URL — follow redirects to login page
ENCODED_REDIRECT=$(urlencode "$REDIRECT_URI")
ENCODED_SCOPES=$(urlencode "$SCOPES")
AUTH_REQUEST="${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${ENCODED_REDIRECT}&scope=${ENCODED_SCOPES}&state=capsule-login"

LOGIN_PAGE=$(curl -sSL -c "$COOKIE_JAR" -b "$COOKIE_JAR" --cacert "$CA_CERT" "$AUTH_REQUEST")

# Step 2: Find the LDAP connector link (Dex connector selection page)
LDAP_LINK=$(echo "$LOGIN_PAGE" | sed -n 's/.*href="\(\/auth\/ldap?[^"]*\)".*/\1/p' | head -1 | sed 's/&amp;/\&/g' || true)

if [ -n "$LDAP_LINK" ]; then
  LOGIN_PAGE=$(curl -sSL -c "$COOKIE_JAR" -b "$COOKIE_JAR" --cacert "$CA_CERT" "https://login.${NIP_DOMAIN}${LDAP_LINK}")
fi

# Step 3: Parse and POST the login form
LOGIN_ACTION=$(extract_attr "action" "$LOGIN_PAGE")

if [ -z "$LOGIN_ACTION" ]; then
  echo "[ERROR] Could not find login form action URL" >&2
  exit 1
fi

if [[ "$LOGIN_ACTION" == /* ]]; then
  LOGIN_ACTION="https://login.${NIP_DOMAIN}${LOGIN_ACTION}"
fi

# POST credentials — capture headers to check for redirect or approval page
curl -sS -D "$WORK_DIR/headers.txt" -o "$WORK_DIR/body.html" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" --cacert "$CA_CERT" \
  --data-urlencode "login=${LDAP_USER}" --data-urlencode "password=${LDAP_PASS}" \
  "$LOGIN_ACTION"

LOCATION=$(grep -i "^location:" "$WORK_DIR/headers.txt" 2>/dev/null | tail -1 | tr -d '\r\n' | awk '{print $2}' || true)
BODY=$(cat "$WORK_DIR/body.html" 2>/dev/null || true)

# Step 4: Handle approval page if present
if echo "$BODY" | grep -q 'name="approval"' 2>/dev/null; then
  APPROVAL_ACTION=$(extract_attr "action" "$BODY")
  if [[ "$APPROVAL_ACTION" == /* ]]; then
    APPROVAL_ACTION="https://login.${NIP_DOMAIN}${APPROVAL_ACTION}"
  fi

  REQ_VALUE=$(echo "$BODY" | sed -n 's/.*name="req" value="\([^"]*\)".*/\1/p' | head -1)

  LOCATION=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" --cacert "$CA_CERT" \
    -w "%{redirect_url}" -o /dev/null \
    -d "req=${REQ_VALUE}&approval=approve" \
    "$APPROVAL_ACTION")
fi

# If no code yet, follow redirects from the location header
if [ -z "$LOCATION" ] || ! echo "$LOCATION" | grep -q "code="; then
  if [ -n "$LOCATION" ]; then
    # Follow the redirect chain, stop at callback
    LOCATION=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" --cacert "$CA_CERT" \
      -w "%{redirect_url}" -o /dev/null \
      "$LOCATION" 2>/dev/null || true)
  fi
fi

# Step 5: Extract authorization code
AUTH_CODE=$(echo "$LOCATION" | sed -n 's/.*code=\([^&]*\).*/\1/p')

if [ -z "$AUTH_CODE" ]; then
  echo "[ERROR] Failed to obtain authorization code" >&2
  echo "[DEBUG] Last location: ${LOCATION:-empty}" >&2
  exit 1
fi

echo "[INFO] Got authorization code, exchanging for tokens..."

# Step 6: Exchange code for tokens
TOKENS=$(curl -sS --cacert "$CA_CERT" \
  -d "grant_type=authorization_code" \
  -d "code=${AUTH_CODE}" \
  -d "redirect_uri=${REDIRECT_URI}" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  "$TOKEN_URL")

# A response that isn't JSON (proxy error page) parses to empty tokens.
ID_TOKEN=$(jq -r '.id_token // empty' 2>/dev/null <<< "$TOKENS") || ID_TOKEN=""
REFRESH_TOKEN=$(jq -r '.refresh_token // empty' 2>/dev/null <<< "$TOKENS") || REFRESH_TOKEN=""

if [ -z "$ID_TOKEN" ]; then
  echo "[ERROR] Failed to obtain tokens" >&2
  # Only the OAuth error fields: a partial response can still carry credentials.
  echo "[DEBUG] Response: $(jq -c '{error, error_description}' 2>/dev/null <<< "$TOKENS" ||
    echo "${TOKENS:0:200}")" >&2
  exit 1
fi

# Step 7: Generate kubeconfig
mkdir -p "$(dirname "$OUTPUT_KUBECONFIG")"
umask 077
CA_DATA=$(base64 < "$CA_CERT" | tr -d '\n')

cat > "$OUTPUT_KUBECONFIG" << EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${CA_DATA}
    server: ${CAPSULE_PROXY}
  name: sd-ui
contexts:
- context:
    cluster: sd-ui
    user: ${LDAP_USER}
  name: sd-ui
current-context: sd-ui
users:
- name: ${LDAP_USER}
  user:
    auth-provider:
      config:
        client-id: ${CLIENT_ID}
        client-secret: ${CLIENT_SECRET}
        id-token: ${ID_TOKEN}
        idp-issuer-url: https://login.${NIP_DOMAIN}
        refresh-token: ${REFRESH_TOKEN}
      name: oidc
EOF

echo "[SUCCESS] Kubeconfig saved to ${OUTPUT_KUBECONFIG#"$PROJECT_DIR"/}"
echo "[INFO]    User: ${LDAP_USER}@sighup.io -> Capsule Proxy: ${CAPSULE_PROXY}"
