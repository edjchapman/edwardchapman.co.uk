# ADR-0026: Upstream failure taxonomy and honest degraded responses

**Status:** Accepted (2026-07-28)

## Context

On 2026-07-25 the Anthropic API credit drained (the ADR-0024 LinkedIn-traffic
incident). Every model call then failed with a billing `400`, and the adapter
folded it — along with a dead key `401`, a retired-model `404`, a `500`, a
`529` overload, and a connection timeout — into a single `provider_error`,
which the service returned to every visitor as one `502 upstream_error` with
the copy _"The answer service had a problem. Nothing you did — try again
shortly."_

That copy was dishonest for three days: the fault was entirely on the
operator's side (top up the credit), retrying could never help, and the page
invited the visitor to keep trying anyway. The only signal distinguishing the
classes lived in the structured log's `detail` field — and on the streaming
path even that was dropped: `streamTerminal` logged a bare `ask.provider_error`
with no detail. There was also a fairness wrinkle: a visitor whose question
failed upstream still had the quota cookie incremented (ADR-0024 counts on
acceptance, before the model call resolves), spending one of their ten daily
questions on an answer they never received.

## Decision

Split upstream failures into two visitor-meaningful classes, carried as a
discriminated-union variant end to end, and make the copy honest about each.

- **Classification, by status only, never by message** (`mapProviderError`,
  `src/lib/agent/anthropic-adapter.ts`). After the existing connection/timeout
  and `RateLimitError` peels, an `APIError` with `400 ≤ status < 500` (429 is
  already handled) becomes `provider_unavailable` — non-retryable, the operator
  must act (billing `400`, dead key `401`, forbidden `403`, retired model
  `404`). Everything else (`500`, `529`, a missing status, an unexpected
  throw) stays `provider_error` — transient, a retry may succeed. The
  content-free `status <n> <type>` detail is unchanged and still logged.

- **A new variant, not a boolean.** `provider_unavailable` is a member of
  `ModelResult`, `ModelStreamEvent`, the `StreamGuard` terminal, the service
  `AgentOutcome`/`AgentStreamEvent`, and the route `ErrorCode` — so every
  exhaustive `switch` fails to compile until it handles the class. A
  `retryable: boolean` field would compile silently if a consumer forgot it.

- **HTTP 503 for `upstream_unavailable`**, 502 kept for `upstream_error`. RFC
  9110: 502 is "invalid response from upstream while proxying" (a transient
  gateway fault); 503 is "the service is currently unable to handle the
  request" (down until the operator acts). The split lets a monitor or any
  status-based tool tell the classes apart with zero body parsing, at no cost
  (both monitors assert 200, so neither cares that a failure became 503).

- **Honest copy** (`src/lib/agent/ask-copy.ts`, the single source both the
  route and the AskForm island import). `upstream_unavailable` →
  _"The answer service is temporarily offline — a fault on Ed's side, flagged
  for attention. Everything the assistant knows is on the published pages."_
  The client additionally renders a pointer to `/experience` and `/projects`
  and never a retry exhortation. `upstream_error` keeps the "try again shortly"
  copy — now that it is genuinely transient-only. The envelope carries the
  class name and friendly copy only; the provider detail never leaves the logs
  (spec §10).

- **Stream-path log parity.** `streamTerminal` is split so a failed stream logs
  the same event and detail the buffered path does (`ask.provider_timeout` /
  `ask.provider_error` with detail / `ask.provider_unavailable` with detail /
  `ask.response_invalid`); an adapter stream that ends with no terminal logs
  `ask.provider_error` with `detail: "missing_terminal"`.

- **Quota fairness (amends ADR-0024).** On the buffered path, an upstream
  failure (`upstream_error`, `upstream_unavailable`, `upstream_rate_limited`,
  or the missing-credential 503) is returned **without** the incremented
  `set-cookie`, so the count never persists — a natural refund for a question
  that got no answer. Refusals still count (the visitor got a truthful answer).
  On the streaming path the headers are already committed at 200-open, so a
  mid-stream failure cannot refund; that loss is accepted and documented.

## Alternatives considered

- **A `retryable: boolean` on `provider_error`.** Rejected: silently
  droppable. A new union member turns every consumer into a compile-time
  checklist.
- **Keep one 502 for both classes.** Rejected: the monitors and any
  status-based tooling lose the class, and the incident-remedy path (top up vs
  rotate) stays ambiguous from the outside.
- **Classify client-side.** Rejected: the error envelope is the contract; the
  server owns the class, and the client renders what it is told.
- **Sniff the provider message** (`"credit balance is too low"`). Rejected:
  brittle across provider wording changes and needlessly ingests provider text
  into our logic. Status is stable and content-free.

## Consequences

- A stale SSE client (a tab opened before this deploy) that receives the new
  `upstream_unavailable` terminal renders the generic transient message for
  that one cached-asset generation — assets are hashed, so the window is one
  tab-lifetime. The buffered 503 path is safe even for old clients (the
  message is envelope-driven). `terminalState` maps any unknown terminal kind
  to the transient error, never a silent idle.
- Anything watching HTTP status must treat 503 as "down" alongside 502. The
  deploy smoke and `uptime-ask` monitor already assert on a grounded 200, so
  both continue to fail (correctly) on a 503 — see the failure-class table in
  `docs/deployment.md`.
- The route's outcome switch is the interception seam a later baseline-answer
  layer (ADR-0027) uses to serve a pre-written answer in place of an
  `upstream_unavailable`.
- Shipping this while the outage is live keeps the deploy smoke red until the
  credit is topped up — expected; the deploy completes first.

## Relations

Amends **ADR-0024** (quota counting: buffered upstream failures no longer
persist the increment). Builds on **ADR-0016** (the SSE "always 200 once
committed" invariant shapes where a class can be surfaced) and **ADR-0018**
(the missing-credential path now returns the non-retryable class). Sits beside
the alerting change that routes the incident's failure class to the maintainer.

## Revisit conditions

- A provider failure mode that is neither cleanly retryable nor cleanly
  operator-actionable (e.g. a soft per-minute cap distinct from `429`) — add a
  third class rather than overloading these two.
- Evidence that visitors act on a `Retry-After` — none is sent today (no honest
  value exists for a billing outage); add one only for a class where a wait
  genuinely helps.
