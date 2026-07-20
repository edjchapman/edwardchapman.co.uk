# ADR-0018: Fail closed on missing model credentials and strip local secrets from builds

**Status:** Accepted (2026-07-20)

## Context

`/api/ask` previously selected the deterministic fake adapter whenever
`ANTHROPIC_API_KEY` was absent. That was convenient for tests, but it also
applied on the canonical production host. A missing or misconfigured Worker
secret could therefore return a plausible, cited fake answer instead of the
documented `upstream_error`, allowing both users and the grounded-answer
monitor to mistake a configuration failure for a healthy service.

The Cloudflare Vite plugin also serialises local development variables into
`dist/server/.dev.vars` so its preview command can reproduce the development
environment. If a developer has an Anthropic key in the repository-local
`.dev.vars`, a successful production build therefore leaves a secret-bearing
file inside `dist/`. The file is excluded from Static Assets uploads, but its
presence still violates the project's stricter rule that secrets must be
absent from build artefacts. It also caused local Playwright runs to use the
live provider when they were intended to exercise the fake adapter.

## Decision

- Adapter selection is environment-explicit. Requests on `localhost` or
  `127.0.0.1` use the deterministic fake adapter, and built local Workers are
  started with an explicit `ASK_MODEL_MODE=fake` binding because Wrangler can
  present their request URL as canonical. The deploy configuration never
  defines that binding. Without local fake mode, the Anthropic adapter is used
  only when `ANTHROPIC_API_KEY` is present; otherwise the endpoint records a
  redacted configuration event and returns the stable `upstream_error`
  response.
- Normal local development, preview and end-to-end tests never require or use
  an Anthropic key. Live provider calls remain explicit through
  `make eval-agent-live` or the protected `eval-live.yml` workflow.
- Every successful production build removes the adapter-generated
  `dist/server/.dev.vars`, then scans `dist/` and fails if a local environment
  file remains anywhere in the output. The sanitizer never reads or prints a
  secret value.
- The privacy page describes the released `/ask` processing path: questions
  are sent to Anthropic, are not stored by this application in a database, and
  are excluded from its structured Worker logs.

## Alternatives considered

- **Keep implicit fake fallback and rely on monitoring.** Rejected: the fake
  produces grounded-looking answers, so the monitor's non-empty-source
  invariant cannot distinguish it from the live provider.
- **Allow the local key to drive the built Worker automatically.** Rejected:
  ordinary browser tests become paid and non-deterministic, contrary to
  ADR-0008, and a secret remains in the build tree.
- **Trust `.assetsignore` alone.** Rejected: it protects the Static Assets
  upload but does not satisfy the repository's broader build-artefact boundary
  or protect other ways the `dist/` directory could be handled.

## Relations

Complements ADR-0008 by keeping deterministic and live model execution
explicitly separate. Complements ADR-0014 by turning a missing Worker key into
the documented safe failure that its smoke tests and incident workflow can
detect. It does not change the retrieval, citation or streaming decisions.

## Consequences

- Missing production credentials are visible failures rather than
  superficially healthy answers.
- Local E2E remains deterministic even when the developer has a local model
  credential configured for other work.
- The explicit fake binding is confined to the checked-in local preview and
  Playwright commands; a regression test prevents it entering `wrangler.jsonc`.
- The generated build remains deployable with `dist/server/wrangler.json`, but
  no longer doubles as a secret-bearing local-preview bundle.
- Testing the live provider is intentionally a separate operation rather than
  an accidental effect of `make preview` or `make test-e2e`.

## Revisit conditions

- Cloudflare adds a supported build option that prevents local variables from
  being serialised while retaining normal local development behavior — prefer
  that option over post-build sanitisation.
- A future local integration test genuinely needs the live route — add a
  separate, explicit command with its own safety warning; do not weaken the
  default fake path.
