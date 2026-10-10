#!/usr/bin/env bash
# Materialize Infisical secrets into this worktree's .env.
# Credentials live on the host only: $HOME/.config/infisical/mi-*.env
# Never commit those files. Never print secret values.
#
# Usage:
#   ./scripts/infisical-env.sh status
#   ./scripts/infisical-env.sh unlock
#
# Override:
#   INFISICAL_CONFIG_DIR   default: $HOME/.config/infisical
#   INFISICAL_DOMAIN       default: from $INFISICAL_CONFIG_DIR/domain or defaults.env
#   INFISICAL_ENV          default: dev

set -euo pipefail

# --- repo-specific (edit per clone) ---
INFISICAL_IDENTITY="${INFISICAL_IDENTITY:-mi-triage}"
# folder:relpath — "/:." → .env; "/:FILE" → FILE at repo root; "dir:dir" → dir/.env
INFISICAL_MAPS="${INFISICAL_MAPS:-/:.}"
# --- end repo-specific ---

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CFG="${INFISICAL_CONFIG_DIR:-${HOME}/.config/infisical}"
ENV_SLUG="${INFISICAL_ENV:-dev}"
IDENTITY_FILE="${CFG}/${INFISICAL_IDENTITY}.env"

resolve_cli() {
  if [[ -n "${INFISICAL_CLI:-}" && -x "${INFISICAL_CLI}" ]]; then
    echo "$INFISICAL_CLI"
  elif command -v infisical >/dev/null 2>&1; then
    command -v infisical
  elif [[ -x "${HOME}/.local/bin/infisical" ]]; then
    echo "${HOME}/.local/bin/infisical"
  else
    return 1
  fi
}

resolve_domain() {
  if [[ -n "${INFISICAL_DOMAIN:-}" ]]; then
    echo "$INFISICAL_DOMAIN"
    return
  fi
  if [[ -f "${CFG}/domain" ]]; then
    tr -d '[:space:]' <"${CFG}/domain"
    return
  fi
  if [[ -f "${CFG}/defaults.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${CFG}/defaults.env"; set +a
    echo "${INFISICAL_DOMAIN:?INFISICAL_DOMAIN missing in defaults.env}"
    return
  fi
  echo "no Infisical domain: set INFISICAL_DOMAIN or run heka t3-host-infisical-apply.sh" >&2
  return 1
}

load_identity() {
  if [[ ! -f "$IDENTITY_FILE" ]]; then
    echo "missing identity file: $IDENTITY_FILE" >&2
    echo "Ask the operator to run heka t3-host-infisical-apply.sh --apply on this host." >&2
    return 1
  fi
  # shellcheck disable=SC1090
  set -a; source "$IDENTITY_FILE"; set +a
  : "${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:?missing CLIENT_ID in $IDENTITY_FILE}"
  : "${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:?missing CLIENT_SECRET in $IDENTITY_FILE}"
  : "${INFISICAL_PROJECT_ID:?missing PROJECT_ID in $IDENTITY_FILE}"
}

login_token() {
  # Requires load_identity already called in the current shell (not a subshell-only load).
  local cli domain
  cli="$(resolve_cli)" || { echo "infisical CLI not found (install to \$HOME/.local/bin/infisical)" >&2; return 1; }
  domain="$(resolve_domain)"
  : "${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:?run load_identity first}"
  : "${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:?run load_identity first}"
  "$cli" login --method=universal-auth \
    --client-id="$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" \
    --client-secret="$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" \
    --domain="$domain" --plain --silent
}

outfile_for() {
  local folder="$1" rel="$2"
  if [[ "$folder" == "/" ]]; then
    if [[ "$rel" == "." ]]; then
      echo "${ROOT}/.env"
    else
      echo "${ROOT}/${rel}"
    fi
  else
    echo "${ROOT}/${rel}/.env"
  fi
}

cmd_status() {
  local cli domain token count
  echo "config_dir=$CFG"
  echo "identity=$INFISICAL_IDENTITY"
  echo "identity_file=$IDENTITY_FILE"
  if [[ -f "$IDENTITY_FILE" ]]; then
    echo "identity_file=present"
  else
    echo "identity_file=MISSING"
  fi
  if cli="$(resolve_cli)"; then
    echo "cli=$cli ($("$cli" --version 2>/dev/null | head -1))"
  else
    echo "cli=MISSING"
    return 1
  fi
  domain="$(resolve_domain)"
  echo "domain=$domain"
  echo "env=$ENV_SLUG"
  echo "maps=$INFISICAL_MAPS"
  load_identity || return 1
  token="$(login_token)" || return 1
  echo "login=ok"
  count="$("$cli" export --token="$token" --domain="$domain" --env="$ENV_SLUG" \
    --projectId="$INFISICAL_PROJECT_ID" --path="/" --format=dotenv --silent 2>/dev/null | grep -c . || true)"
  echo "root_keys=$count"
}

write_env_file() {
  local dest="$1" content="$2"
  local n tmp
  n="$(printf '%s\n' "$content" | grep -c . || true)"
  if [[ "$n" -eq 0 ]]; then
    echo "SKIP  empty → $dest"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  tmp="$(mktemp)"
  printf '%s\n' "$content" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$dest"
  chmod 600 "$dest"
  echo "WROTE $dest ($n keys)"
}

export_path() {
  local cli="$1" token="$2" domain="$3" path="$4"
  "$cli" export --token="$token" --domain="$domain" --env="$ENV_SLUG" \
    --projectId="$INFISICAL_PROJECT_ID" --path="$path" --format=dotenv --silent 2>/dev/null || true
}

cmd_unlock() {
  local cli domain token entry folder rel dest content
  cli="$(resolve_cli)" || { echo "infisical CLI not found" >&2; return 1; }
  domain="$(resolve_domain)"
  load_identity || return 1
  token="$(login_token)" || return 1

  IFS=';'
  for entry in $INFISICAL_MAPS; do
    folder="${entry%%:*}"
    rel="${entry#*:}"
    [[ "$folder" == /* ]] || folder="/${folder}"
    content="$(export_path "$cli" "$token" "$domain" "$folder")"
    dest="$(outfile_for "$folder" "$rel")"
    write_env_file "$dest" "$content"
  done
}

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    status) cmd_status ;;
    unlock) cmd_unlock ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 2 ;;
    *) echo "Unknown command: $cmd" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
