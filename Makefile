# Generic project quality gate — vendored into this repo by claude-code-config's
# `setup-project.sh --tooling`. `make check` is the single aggregate gate that CI
# (.github/workflows/check.yml), the pre-commit hook (.githooks/pre-commit), and the
# weekly scheduled run (.github/workflows/scheduled-check.yml) all call.
#
# This file is yours now — edit freely. The most important edit is wiring your
# stack's lint/test into `stack-check` (see the comment block below).

.PHONY: help check check-links check-anchors stack-check \
        check-commit-msg check-stale-branches sweep-branches lint-md

.DEFAULT_GOAL := help

# === Help ===

help: ## Print this help message (lists all annotated targets)
	@awk 'BEGIN { FS = ":.*##"; printf "Project tooling — available targets\n\n" } \
		/^# === / { printf "\n\033[1m%s\033[0m\n", substr($$0, 3) } \
		/^[a-z][a-zA-Z0-9_%-]*:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# === Validation (run by CI + pre-commit) ===

check: check-links check-anchors stack-check ## Run the full validation battery
	@echo "All checks passed."

check-links: ## Verify internal markdown links resolve
	@./scripts/check-links.sh

check-anchors: ## Verify markdown anchor fragments resolve to heading slugs
	@python3 scripts/check_anchors.py

stack-check: ## Format check + type check + production build
	@npx prettier --check . && npx astro check && npm run build

# === On-demand (not part of make check) ===

check-commit-msg: ## Validate a commit subject (FILE=<path> or pipe via --stdin)
	@./scripts/check-commit-msg.sh $${FILE:---stdin}

check-stale-branches: ## Surface stale local branches (requires gh + jq)
	@./scripts/check-stale-branches.sh

sweep-branches: ## Delete bucket-A stale branches; dry-run unless APPLY=1
	@./scripts/sweep-stale-branches.sh

lint-md: ## Run markdownlint locally against **/*.md (requires npx)
	@npx --yes markdownlint-cli2 "**/*.md"
