# edwardchapman.co.uk

[![check](https://github.com/edjchapman/edwardchapman.co.uk/actions/workflows/check.yml/badge.svg)](https://github.com/edjchapman/edwardchapman.co.uk/actions/workflows/check.yml)

Source for [edwardchapman.co.uk](https://edwardchapman.co.uk) — Ed Chapman's
personal site: a recruiter-facing homepage, project case studies, technical
notes, and (behind release gates) an "ask about my work" agent that answers
only from published site content.

The repository is itself part of the portfolio. It is built spec-first
([docs/spec.md](docs/spec.md)), records its architecture decisions as ADRs
([docs/adr/](docs/adr/)), enforces its content-safety policy mechanically,
and deploys reproducibly from CI.

**Status: Phase 0 (bootstrap) — deploying to a temporary workers.dev URL;
domain cutover lands with Phase 1.**

## Architecture in one paragraph

An Astro 7 static-first site served from **Cloudflare Workers Static Assets**:
prerendered pages are served from the asset layer without invoking any code,
and a small Worker handles only explicit `prerender = false` routes
(`/api/health` now; `/api/ask` in Phase 3). Content is typed data in Astro
content collections, validated by shared zod schemas that the build scripts
and the future agent-corpus builder reuse. React appears only as interactive
islands, and none exist before Phase 3. Full picture:
[docs/architecture.md](docs/architecture.md).

## Technology choices

Astro 7 · TypeScript (strictest) · Cloudflare Workers + Static Assets ·
wrangler 4 · pnpm 11 / Node 24 LTS · Vitest · Playwright · ESLint 10 +
Prettier 3 · GitHub Actions. The *why* for each load-bearing choice is an
ADR: [docs/adr/](docs/adr/).

## Local setup

```sh
git clone https://github.com/edjchapman/edwardchapman.co.uk.git
cd edwardchapman.co.uk
make setup    # corepack-enable pnpm + install (frozen lockfile)
make check    # full gate — green on a fresh clone
make dev      # dev server at localhost:4321
```

Details and troubleshooting: [docs/development.md](docs/development.md).

## Commands

| | |
|---|---|
| `make check` | format, lint, `astro check`, unit tests, build, content-policy scan, built-output link checks |
| `make test-e2e` | Playwright against the built site |
| `make preview` | production build via `wrangler dev` |
| `make eval-agent` / `make eval-agent-live` | agent evaluations (defined in Phases 3–4; see [docs/evaluation.md](docs/evaluation.md)) |
| `make help` | everything else |

## Environment variables

None for local development. Deploys use `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` (GitHub Actions secrets). The agent (Phases 3–4)
introduces the `ANTHROPIC_MODEL` binding and the `ANTHROPIC_API_KEY` Worker
secret — server-side only, never exposed to the browser.

## Deployment

Squash-merge to `main` → required checks → `deploy.yml` (GitHub `production`
environment) → `wrangler deploy` against the adapter-emitted config. PRs get
preview uploads aliased `pr-<n>`. Rollback is `wrangler rollback`, verified
via `/api/health` (which reports the serving commit). Process and runbooks:
[docs/deployment.md](docs/deployment.md).

## Content authoring

Content lives in typed collections under `src/content/` — schema-validated at
build time, `draft: true` to keep an entry out of production. Sources and
prohibitions are defined in [docs/content-policy.md](docs/content-policy.md)
and enforced by a scanner inside `make check`.

## Security & privacy summary

No analytics, no cookies, no accounts. Private career material never enters
this repository, its build artefacts, prompts, or logs — a fail-closed
content-policy gate enforces the boundary
([ADR-0007](docs/adr/0007-public-content-boundary.md)). The agent (when it
ships) answers only from published content, refuses rather than improvises,
and is gated by deterministic + live evaluations and a manual red-team pass
([docs/evaluation.md](docs/evaluation.md)). Threat model:
[docs/threat-model.md](docs/threat-model.md).

## Repository status

| Phase | Scope | State |
|---|---|---|
| 0 | Spec, bootstrap, scaffold, CI, temporary URL | **in progress** |
| 1 | Recruiter homepage, colophon, domain cutover | pending |
| 2 | Case studies, notes, security headers | pending |
| 3 | Agent foundation (corpus, retrieval, fake adapter) | pending |
| 4 | Live model integration, gated /ask release | pending |
