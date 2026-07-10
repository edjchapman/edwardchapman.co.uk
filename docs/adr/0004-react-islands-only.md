# ADR-0004: React only for interactive islands — and none before Phase 3

**Status:** Accepted (2026-07-10)

## Context

The spec requires the primary site to remain useful with JavaScript disabled
and positions React as a selective tool, not a foundation. The only planned
feature that genuinely needs client-side interactivity is the Phase-3 "ask"
interface (form submission with loading/error states and accessible status
announcements).

## Decision

No React packages are installed until Phase 3. When the ask interface lands,
`@astrojs/react` is added and the interactive boundary is a single island
(`AskForm`), hydrated with a lazy client directive. Everything else remains
server-rendered HTML. New islands require the same justification this ADR
gives the first one: a real interaction that HTML and CSS cannot express.

## Alternatives considered

- **React everywhere** — pays hydration and bundle cost on pages that are
  prose. Rejected.
- **No framework, hand-rolled JS for the ask UI** — viable, but the form's
  state machine (idle/loading/answer/error with aria-live updates) is where a
  component model earns its keep, and demonstrating *selective* React use is
  an explicit goal of the artefact.
- **Lighter islands (Preact/Svelte)** — defensible; React chosen because it
  matches the professional positioning the site documents and the ecosystem
  the projects use.

## Consequences

- Phases 0–2 ship zero client-side JavaScript.
- The dependency tree stays free of UI-framework churn until a feature pays
  for it.
- The ask page must be designed with a no-JS fallback message, since its
  island is the one part of the site that requires JavaScript.

## Revisit conditions

- A second interactive feature emerges; if islands multiply, reassess
  whether the boundary discipline still holds.
