# ADR-0001: Astro 7 with strict TypeScript

**Status:** Accepted (2026-07-10)

## Context

The site is content-first (homepage, case studies, notes) with exactly one
planned interactive feature (the Phase-3 "ask" interface). It must be fast,
useful without JavaScript, and demonstrate deliberate frontend architecture
rather than a defaulted framework choice. The commissioning spec
([docs/spec.md](../spec.md)) mandates this stack unless implementation
evidence establishes a serious incompatibility; this ADR records why the
mandate is sound rather than merely inherited.

## Decision

Astro 7 with `tsconfig` extending `astro/tsconfigs/strictest`. Content is
typed data in Astro content collections (ADR-0005 builds on this). All pages
prerender by default (ADR-0003); interactivity arrives only as islands
(ADR-0004).

## Alternatives considered

- **Next.js** — brings a React runtime and server component machinery the
  site doesn't need; JavaScript-first by default, so "works without JS" is a
  fight rather than the baseline. Rejected.
- **React SPA (Vite)** — client-rendered navigation contradicts the
  no-JS requirement outright. Rejected.
- **Plain static HTML / eleventy** — meets the performance bar but lacks
  typed content collections and first-class islands for Phase 3; the typed
  content layer is what the corpus builder depends on. Rejected.
- **Astro with loose TypeScript** — strictest mode costs little on a fresh
  codebase and catches the frontmatter/content drift this architecture leans
  on. Looser settings rejected.

## Consequences

- Zero client JavaScript until Phase 3; Lighthouse and accessibility budgets
  are easy to hold.
- Content collections give schema-validated frontmatter (`src/lib/schemas.ts`)
  shared with build scripts.
- Astro 7's Vite 8 toolchain pins us to modern Node (24 LTS, `engines` field).
- Team familiarity with React remains usable inside islands without paying
  for it site-wide.

## Revisit conditions

- The site grows genuinely app-like surfaces (auth, dashboards) that fight
  the MPA model.
- Astro's maintenance or the Cloudflare adapter's support materially degrades.
