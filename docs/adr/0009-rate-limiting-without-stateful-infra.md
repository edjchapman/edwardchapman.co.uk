# ADR-0009: Rate limiting via the Workers rate-limit binding

**Status:** Accepted (2026-07-11)

## Context

`/api/ask` (Phase 3+) turns visitor input into paid model calls, so it needs
per-client rate limiting (spec §10, §13) — but the spec bans KV, Durable
Objects, and D1 without a recorded justification, which rules out the classic
counter-in-storage designs.

## Decision

Use Cloudflare's **Workers rate-limiting binding** (GA): a per-IP limit of
10 requests / 60 seconds on `/api/ask`, keyed on the `cf-connecting-ip`
header (Cloudflare's trusted client address — never browser-supplied
values). Configured in `wrangler.jsonc` (`ratelimits`), consumed in the
route; when the binding is absent (local dev, unit tests) the check is
skipped and integration tests inject a mock. Defence in depth on top:
request-size caps (4 KB), question-length caps (500 chars), a host gate
(previews never expose the agent), `max_tokens` bounds on the eventual
provider call, and — in Phase 4 — AI Gateway limits and spend caps on the
provider side.

## Alternatives considered

- **KV/DO-backed counters** — precise sliding windows, but exactly the
  stateful infrastructure the spec prohibits for this need. Rejected.
- **Zone WAF rate-limiting rules** — workable, but lives in dashboard state
  outside the repository and (deliberately) outside the deploy token's
  scopes; the binding keeps limits versioned with the code. Rejected as the
  primary mechanism, available as an additive layer later.
- **No limiting until the live model ships** — the route exists from Phase 3
  and the machinery must be tested before it guards real spend. Rejected.

## Consequences

- Limits are approximate per-edge-location rather than globally exact —
  acceptable for abuse control (cost is additionally bounded by AI Gateway
  caps and `max_tokens`).
- The binding has no dashboard analytics; hits are visible through the
  structured `ask.provider_rate_limited`/`rate_limited` events in Workers
  logs.
- Local behaviour differs (no binding) — covered by injecting a mock in
  integration tests, and verified live in the Phase 4 429 test.

## Revisit conditions

- Abuse patterns that per-IP limiting can't hold (distributed scraping) —
  then WAF rules and Turnstile become candidates, each via ADR.
