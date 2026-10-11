---
name: infisical-secrets
description: >-
  Unlock triage secrets into this worktree's .env when it is missing, an API key
  seems absent, a new T3 worktree was created, or `make smoke` / the CLI fails
  for missing config. Use make secrets-status / secrets-unlock. Never print
  secret values. Credentials live only under $HOME/.config/infisical/.
---

# Infisical secrets (triage)

## When to use

| Situation | Action |
|-----------|--------|
| New T3 worktree / fresh clone | `make secrets-unlock` |
| Missing `.env` | `make secrets-unlock` |
| `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY` not set | `make secrets-status`, then `make secrets-unlock` |
| `.env` already present and working | Do nothing |

## Rules

1. **Never** put client IDs, client secrets, or `.env` values in chat, commits, issues, or this skill. This repo is public.
2. Credentials are host-local: `$HOME/.config/infisical/mi-triage.env` (identity) and `$HOME/.config/infisical/domain`.
3. Do **not** invent env values. If unlock fails because the identity file is missing, stop and tell the operator the host needs the `mi-triage` identity installed.
4. A key missing from Infisical is reported as a `SKIP` by `make smoke`; tell the operator rather than working around it. `TYPESAFE_API_KEY` is optional: without it Jev is reached through OpenRouter.

## Commands (repo root)

```bash
make secrets-status    # CLI + identity + login check, key count only
make secrets-unlock    # write .env (mode 0600)
```
