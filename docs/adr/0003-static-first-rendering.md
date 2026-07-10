# ADR-0003: Static generation by default; request-time execution by exception

**Status:** Accepted (2026-07-10)

## Context

Every page on this site is knowable at build time except the agent API. A
runtime that renders content pages on request would add latency, cost, and a
failure surface for no benefit — and would blur the public-content boundary
(ADR-0007), which depends on published output being a deterministic build
artefact.

## Decision

All routes prerender by default (Astro static output). Request-time
execution is limited to routes that declare `export const prerender = false`,
and adding one requires review against this ADR. The initial set is exactly
`/api/health` (deploy verification) and, from Phase 3, `/api/ask`.

The gate enforces the boundary's consequences: `make check` builds the site
and then validates the built output (content policy, internal links) — checks
that only make sense because the output is fully materialised at build time.

## Alternatives considered

- **SSR-by-default with caching** — cache invalidation work to reach the
  performance static gets for free. Rejected.
- **Hybrid per-page choices made ad hoc** — drift risk; the explicit
  `prerender = false` + ADR review rule keeps the dynamic surface enumerable.

## Consequences

- Content changes ship via git + CI, never at request time. This is also what
  makes the Phase-3 corpus deterministic and versioned.
- The Worker stays tiny: static asset requests do not invoke it at all.
- Anything genuinely dynamic must justify itself in writing first.

## Revisit conditions

- A feature (per spec Phase 5's evidence protocol) genuinely requires
  request-time rendering of content pages.
