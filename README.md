# edwardchapman.co.uk

[![check](https://github.com/edjchapman/edwardchapman.co.uk/actions/workflows/check.yml/badge.svg)](https://github.com/edjchapman/edwardchapman.co.uk/actions/workflows/check.yml)

Source for [edwardchapman.co.uk](https://edwardchapman.co.uk) — Ed Chapman's
personal site: a recruiter-facing homepage, project case studies, technical
notes, and (in a later phase) a grounded "ask about my work" agent that answers
only from published site content.

The repository is itself part of the portfolio: spec-first development
([docs/spec.md](docs/spec.md)), recorded architecture decisions
([docs/adr/](docs/adr/)), a deterministic quality gate, and reproducible
deploys to Cloudflare Workers.

**Status: Phase 0 (bootstrap) — not yet live.**

## Stack

Astro 7 (static-first) · TypeScript (strictest) · Cloudflare Workers with
Static Assets · pnpm · Vitest + Playwright · GitHub Actions.

## Quick start

```sh
make setup   # corepack-enable pnpm + install dependencies
make check   # full gate: links, format, lint, types, tests, build, content policy
make dev     # local dev server
make help    # everything else
```

Full documentation: [docs/development.md](docs/development.md),
[docs/architecture.md](docs/architecture.md),
[docs/deployment.md](docs/deployment.md).
