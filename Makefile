.PHONY: help setup lint typecheck test smoke check secrets-status secrets-unlock

help:
	@echo "  make secrets-status   Check Heka Vault key + triage project (key counts only)"
	@echo "  make secrets-unlock   Write .env from the triage Heka Vault project (mode 0600)"
	@echo "  make setup            npm ci (npm install when there is no lockfile)"
	@echo "  make check            lint + typecheck + test (what CI runs)"
	@echo "  make smoke            One live call each to OpenRouter and Jev (needs .env)"

secrets-status:
	@./scripts/heka-vault-env.sh status

secrets-unlock:
	@./scripts/heka-vault-env.sh unlock

setup:
	@if [ -f package-lock.json ]; then npm ci; else npm install; fi

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm test

check: lint typecheck test

smoke:
	npm run smoke
