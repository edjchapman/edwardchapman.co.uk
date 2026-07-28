# Project quality gate — vendored base from claude-code-config, wired for this
# repo's Astro/TypeScript/Cloudflare stack. `make check` is the single aggregate
# gate that CI (.github/workflows/check.yml), the pre-commit hook
# (.pre-commit-config.yaml via the global dispatcher), and the weekly scheduled
# run (.github/workflows/scheduled-check.yml) all call.
#
# `eval-agent` and `eval-agent-live` are defined in Phases 3–4 (see
# docs/evaluation.md); the names are reserved here.

.PHONY: help setup dev preview check check-links check-anchors stack-check corpus og-cards icons llms \
        format-check lint typecheck test build check-content check-dist-links \
        format lint-fix test-e2e check-perf check-external-links eval-agent eval-agent-live \
        deploy deploy-preview \
        deploy-www-redirect rotate-anthropic-key \
        check-commit-msg check-stale-branches sweep-branches lint-md

.DEFAULT_GOAL := help

# === Help ===

help: ## Print this help message (lists all annotated targets)
	@awk 'BEGIN { FS = ":.*##"; printf "Project tooling — available targets\n\n" } \
		/^# === / { printf "\n\033[1m%s\033[0m\n", substr($$0, 3) } \
		/^[a-z][a-zA-Z0-9_%-]*:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# === Setup & local development ===

setup: ## Enable pnpm via corepack and install dependencies
	@corepack enable pnpm && pnpm install --frozen-lockfile

dev: ## Start the Astro dev server
	@pnpm run dev

preview: ## Serve the production build locally via wrangler (build first)
	@pnpm run build && pnpm run preview

# === Validation (run by CI + pre-commit) ===

check: check-links check-anchors stack-check ## Run the full validation battery
	@echo "All checks passed."

check-links: ## Verify internal markdown links resolve
	@./scripts/check-links.sh

check-anchors: ## Verify markdown anchor fragments resolve to heading slugs
	@python3 scripts/check_anchors.py

stack-check: format-check lint typecheck test build check-content check-dist-links ## Astro/TS gate: format, lint, types, tests, build, content policy, dist links

format-check: ## Prettier in check mode
	@pnpm exec prettier --check .

lint: ## ESLint over the repo
	@pnpm exec eslint .

corpus: ## Generate src/generated/corpus.json (the /api/ask route imports it)
	@node scripts/build-agent-corpus.ts

baseline: ## Generate src/generated/baseline.json (pre-answered questions, ADR-0027)
	@node scripts/build-baseline-answers.ts

og-cards: ## Generate per-page social cards into public/og/
	@node scripts/build-og-cards.ts

icons: ## Generate apple-touch-icon.png and manifest icon fallbacks into public/
	@node scripts/build-icons.ts

llms: ## Generate public/llms.txt from published content
	@node scripts/build-llms-txt.ts

typecheck: corpus baseline ## astro check (TypeScript + .astro diagnostics)
	@pnpm exec astro check

test: ## Vitest unit/integration suites (corpus via vitest globalSetup)
	@pnpm exec vitest run

# Delegates to the package.json "build" chain so there is exactly one build
# entrypoint. A second Makefile-maintained step list silently dropped
# build-llms-txt from production (2026-07-21): local trees masked it with a
# leftover gitignored public/llms.txt, and CI e2e passed because Playwright's
# webServer runs the pnpm chain. One list, or the lists drift.
build: ## Production build (dist/) via the package.json chain
	@pnpm run build

check-content: ## Content-policy scan over sources and built output
	@node scripts/check-content-policy.ts

check-dist-links: ## Validate internal links + canonical policy in dist/
	@node scripts/check-internal-links.ts

# === On-demand (not part of make check) ===

format: ## Prettier in write mode
	@pnpm exec prettier --write .

lint-fix: ## ESLint with --fix
	@pnpm exec eslint . --fix

test-e2e: ## Playwright end-to-end suite (built site via wrangler dev)
	@pnpm exec playwright test

check-perf: ## Lighthouse budgets against the built site (lighthouserc.json)
	@pnpm build && pnpm exec lhci autorun

check-external-links: ## Probe external URLs in content (manual + weekly; not in `check`)
	@node scripts/check-external-links.ts

eval-agent: ## Deterministic agent evaluations (also run inside `make check` via test)
	@pnpm exec vitest run tests/agent

eval-agent-live: ## Live model evaluation vs thresholds (needs ANTHROPIC_API_KEY)
	@node scripts/run-agent-evals.ts

redteam-live: ## Live security probe vs a deployed origin (PROBE_ORIGIN=... to override)
	@node scripts/probe-live-security.ts

deploy: ## Deploy the current build to Cloudflare (CI does this from main)
	@pnpm exec wrangler deploy --config dist/server/wrangler.json

deploy-preview: ## Upload a preview version (ALIAS=<name>, defaults to local)
	@pnpm exec wrangler versions upload --config dist/server/wrangler.json --preview-alias $${ALIAS:-local}

deploy-www-redirect: ## Deploy the www→apex redirect worker (rarely changes)
	@pnpm exec wrangler deploy --config workers/www-redirect/wrangler.jsonc

rotate-anthropic-key: ## Rotate ANTHROPIC_API_KEY across Worker + GitHub in one command (ADR-0014)
	@./scripts/rotate-anthropic-key.sh

check-commit-msg: ## Validate a commit subject (FILE=<path> or pipe via --stdin)
	@./scripts/check-commit-msg.sh $${FILE:---stdin}

check-stale-branches: ## Surface stale local branches (requires gh + jq)
	@./scripts/check-stale-branches.sh

sweep-branches: ## Delete bucket-A stale branches; dry-run unless APPLY=1
	@./scripts/sweep-stale-branches.sh

lint-md: ## Run markdownlint locally against **/*.md (requires npx)
	@npx --yes markdownlint-cli2 "**/*.md"
