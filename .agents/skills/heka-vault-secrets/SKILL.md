---
name: heka-vault-secrets
description: >-
  Unlock triage secrets from Heka Vault into this worktree's .env when it is
  missing, an API key seems absent, a new T3 worktree was created, or
  `make smoke` / the CLI fails for missing config. Use make secrets-status /
  secrets-unlock. Never print secret values.
---

# Heka Vault secrets (triage)

Secrets live in the internal Heka Vault service, project `triage`, environment `dev`, path `/`.
`scripts/heka-vault-env.sh` writes that folder to `.env` at the repo root (mode 0600).

## When to use

| Situation | Action |
|-----------|--------|
| New T3 worktree / fresh clone | `make secrets-unlock` |
| Missing `.env` | `make secrets-unlock` |
| `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY` not set | `make secrets-status`, then `make secrets-unlock` |
| `.env` already present and working | Do nothing |

## Commands (repo root)

```bash
make secrets-status    # credentials + whoami + vault key count (no values)
make secrets-unlock    # write .env (mode 0600)
```

## Rules

1. **Never** put tokens or `.env` values in chat, commits, issues, or this skill. This repo is public.
2. Credentials are host-local: `$HOME/.config/heka-vault/triage.env` (`HEKA_VAULT_URL`,
   `HEKA_VAULT_PROJECT`, `HEKA_VAULT_TOKEN`, mode 600).
3. Do **not** invent env values. If unlock fails because the credentials file is missing, stop and
   tell the operator the host needs a Heka Vault key for `triage`.
4. A key missing from the vault is reported as a `SKIP` by `make smoke`; tell the operator rather
   than working around it. `TYPESAFE_API_KEY` is optional: without it Jev is reached through
   OpenRouter.
5. A secret the vault already holds is **not** a reason for `needs-info`. Unlock it and continue.
6. Never pull `prod` onto a dev machine.

## API

Full OpenAPI spec: `$HEKA_VAULT_URL/api/v1/openapi.json`. Every call sends
`Authorization: Bearer $HEKA_VAULT_TOKEN`. Query params `env` (default `dev`) and `path` (default
`/`) select the location. Keys are `read` or `readwrite`; `403 this key is read-only` means this
host can't write, so ask the operator.

```bash
set -a; source "$HOME/.config/heka-vault/triage.env"; set +a
H="Authorization: Bearer $HEKA_VAULT_TOKEN"
API="$HEKA_VAULT_URL/api/v1/projects/$HEKA_VAULT_PROJECT"

# List key names only (no values)
curl -fsS -H "$H" "$API/secrets?env=dev&path=/" | jq -r '.secrets[].key'

# Use one value without printing it
MESHY_API_KEY="$(curl -fsS -H "$H" "$API/secrets/MESHY_API_KEY?env=dev&path=/&format=raw")"

# Set one secret (readwrite keys only). Never put the value on the command line as a literal.
jq -n --arg v "$NEW_VALUE" '{value: $v}' |
  curl -fsS -X PUT -H "$H" -H 'content-type: application/json' --data-binary @- "$API/secrets/MY_KEY?env=dev&path=/"
```
