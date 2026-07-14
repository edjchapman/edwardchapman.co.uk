# ADR-0010: Lighthouse budgets in CI; RSS and social-card automation pulled forward

**Status:** Accepted (2026-07-14, recording decisions shipped 2026-07-12/13)

## Context

Spec §18 (Phase 5) listed RSS and automated social-card generation as
possible future work, and the spec had no performance-measurement mechanism
beyond design principles. All three landed during Phase 2–4 delivery (PRs
#33, #34, #36) without a recorded decision — this ADR closes that gap.

## Decision

- **Lighthouse budgets on every PR** (`perf.yml`, `make check-perf`,
  thresholds in `lighthouserc.json`): performance ≥ 0.85, accessibility /
  best practices / SEO ≥ 0.95, measured over `/`, a project page, a note
  page, and `/ask`. Budgets sit just below the 2026-07-13 baseline (100s
  everywhere; `/ask` 93 performance from island hydration) so regressions
  fail without pinning brittle perfect scores. Deliberately **not** a
  required check — the deterministic gate stays `make check` (ADR-0008
  rationale applies: required checks must be deterministic).
- **RSS in Phase 2** (`src/pages/rss.xml.ts`): the notes section shipped with
  real content, and a feed is a static build artefact with zero runtime cost
  — deferring it bought nothing.
- **Social-card automation in Phase 2** (`scripts/build-og-cards.ts`): spec
  §9 already mandated per-page cards; generating them pre-build from
  frontmatter was cheaper than hand-authoring PNGs and keeps cards in sync
  with content. Details: docs/architecture.md § Build pipeline.

## Consequences

- Performance regressions surface on the PR, not after deploy, at the cost
  of one non-required CI job (~3 min).
- Spec §18's Phase-5 list is annotated rather than rewritten; remaining
  items there still require the spec's measure-first justification.
