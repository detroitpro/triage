#!/usr/bin/env bash
# Materialize Heka Vault secrets into this worktree's .env files.
# Credentials live on the host only: $HOME/.config/heka-vault/<project>.env
# Never commit those files. Never print secret values.
#
# Usage:
#   ./scripts/heka-vault-env.sh status
#   ./scripts/heka-vault-env.sh unlock
#
# Override:
#   HEKA_VAULT_CONFIG_DIR   default: $HOME/.config/heka-vault
#   HEKA_VAULT_ENV          default: dev
#   HEKA_VAULT_MAPS         default: per repo below

set -euo pipefail

# --- repo-specific ---
HEKA_VAULT_PROJECT="${HEKA_VAULT_PROJECT:-triage}"
# folder:relpath — "/:." → .env; "/:FILE" → FILE at repo root; "dir:dir" → dir/.env
HEKA_VAULT_MAPS="${HEKA_VAULT_MAPS:-/:.}"
# --- end repo-specific ---

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CFG="${HEKA_VAULT_CONFIG_DIR:-${HOME}/.config/heka-vault}"
ENV_SLUG="${HEKA_VAULT_ENV:-dev}"
CRED_FILE="${CFG}/${HEKA_VAULT_PROJECT}.env"

load_credentials() {
  if [[ ! -f "$CRED_FILE" ]]; then
    echo "missing credentials file: $CRED_FILE" >&2
    echo "Ask the operator to provision a Heka Vault key for '$HEKA_VAULT_PROJECT' on this host." >&2
    return 1
  fi
  # shellcheck disable=SC1090
  set -a; source "$CRED_FILE"; set +a
  : "${HEKA_VAULT_URL:?missing HEKA_VAULT_URL in $CRED_FILE}"
  : "${HEKA_VAULT_TOKEN:?missing HEKA_VAULT_TOKEN in $CRED_FILE}"
}

# GET an API path. Writes the body to stdout; fails with the server's error message on non-2xx.
api_get() {
  local tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer ${HEKA_VAULT_TOKEN}" \
    "${HEKA_VAULT_URL}/api/v1$1")" || { rm -f "$tmp"; echo "cannot reach $HEKA_VAULT_URL" >&2; return 1; }
  if [[ "$code" != 2* ]]; then
    echo "HTTP $code from $1: $(head -c 300 "$tmp")" >&2
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

outfile_for() {
  local folder="$1" rel="$2"
  if [[ "$folder" == "/" ]]; then
    if [[ "$rel" == "." ]]; then echo "${ROOT}/.env"; else echo "${ROOT}/${rel}"; fi
  else
    echo "${ROOT}/${rel}/.env"
  fi
}

urlencode() {
  local s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in [a-zA-Z0-9.~_-]) out+="$c" ;; *) out+="$(printf '%%%02X' "'$c")" ;; esac
  done
  echo "$out"
}

cmd_status() {
  echo "project=$HEKA_VAULT_PROJECT"
  echo "env=$ENV_SLUG"
  echo "maps=$HEKA_VAULT_MAPS"
  if [[ -f "$CRED_FILE" ]]; then echo "credentials=$CRED_FILE (present)"; else echo "credentials=$CRED_FILE (MISSING)"; fi
  load_credentials || return 1
  echo "url=$HEKA_VAULT_URL"
  local who IFS=',' map folder rel out n
  who="$(api_get /whoami)" || return 1
  echo "whoami=$who"
  for map in $HEKA_VAULT_MAPS; do
    folder="${map%%:*}"; rel="${map#*:}"; out="$(outfile_for "$folder" "$rel")"
    n="$(api_get "/projects/${HEKA_VAULT_PROJECT}/secrets?env=${ENV_SLUG}&path=$(urlencode "$folder")&format=dotenv" | grep -c '^[A-Za-z_]' || true)"
    if [[ -f "$out" ]]; then echo "$folder -> ${out#"$ROOT"/} (exists, vault has $n keys)"; else echo "$folder -> ${out#"$ROOT"/} (MISSING, vault has $n keys)"; fi
  done
}

cmd_unlock() {
  load_credentials || return 1
  local IFS=',' map folder rel out tmp
  for map in $HEKA_VAULT_MAPS; do
    folder="${map%%:*}"; rel="${map#*:}"; out="$(outfile_for "$folder" "$rel")"
    mkdir -p "$(dirname "$out")"
    tmp="$(mktemp "$(dirname "$out")/.heka-vault.XXXXXX")"
    chmod 600 "$tmp"
    if ! api_get "/projects/${HEKA_VAULT_PROJECT}/secrets?env=${ENV_SLUG}&path=$(urlencode "$folder")&format=dotenv" >"$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    mv "$tmp" "$out"
    echo "wrote ${out#"$ROOT"/} ($(grep -c '^[A-Za-z_]' "$out" || true) keys from $ENV_SLUG:$folder)"
  done
}

case "${1:-status}" in
  status) cmd_status ;;
  unlock) cmd_unlock ;;
  *) echo "usage: $0 status|unlock" >&2; exit 2 ;;
esac
