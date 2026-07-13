# Repository rules for AI-assisted work

This repo is a public demonstration artefact. These rules override convenience.

## Before implementing

- **Read the specification first.** `docs/spec.md` is the commissioning spec;
  `docs/adr/` records the architecture decisions. Work spec-first: if a change
  conflicts with the spec or an ADR, update the document (or write a new ADR)
  before writing the code.
- Inspect the current repo state before assuming anything about it.

## Content boundary (hard rules)

- **Never invent professional claims.** Every statement about Ed's work must
  trace to a public source (public repos, live demos, published site content).
  No unverifiable metrics, no embellishment.
- **Never ingest private material.** The private `career-portfolio` repo,
  private notes, recruiter conversations, salary details, and anything under
  `~/Reference` are off-limits — not in content, not in prompts, not in
  fixtures, not in commit messages. `docs/content-policy.md` is authoritative;
  `scripts/check-content-policy.ts` enforces it mechanically.
- The agent corpus (Phase 3+) may only contain published, non-draft content
  collections. Never widen the corpus boundary to make an answer possible.

## Engineering rules

- **Static by default.** Pages are prerendered unless an ADR justifies
  `prerender = false`. Only `/api/*` routes run in the Worker.
- **React islands stay narrow.** No React until an interactive island needs it
  (ADR-0004); never hydrate whole pages.
- **Tests accompany behaviour changes.** New behaviour without a test is
  incomplete work.
- **Run `make check` before declaring anything done.** It is the same gate CI
  enforces. E2E changes also need `make test-e2e`.
- **Update ADRs when architecture changes.** A decision that contradicts an
  ADR requires a superseding ADR, not a silent drift.
- **Never expose secrets.** No keys in code, config, fixtures, logs, or
  `.dev.vars` committed by accident. Anthropic/Cloudflare credentials live in
  Worker secrets and GitHub Actions secrets only.
- **Never weaken an evaluation to make CI pass.** If an eval fails, fix the
  behaviour or record a justified threshold change in `docs/evaluation.md` —
  lowering a bar silently is prohibited.

## Git conventions

- Conventional commits, strict (`scripts/check-commit-msg.sh`); the PR title
  becomes the squash-commit subject on `main`.
- Keep commits and PRs focused and reviewable — one coherent change each.
- Never commit directly to `main`; never bypass required checks.
