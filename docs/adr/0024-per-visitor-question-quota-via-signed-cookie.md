# ADR-0024: Per-visitor question quota via a signed cookie

**Status:** Accepted (2026-07-25)

## Context

On 2026-07-25 a LinkedIn post drove traffic to the ask endpoint and the
Anthropic API credit drained almost immediately. The only protection was
ADR-0009's per-IP rate limit — 10 requests per 60 seconds — which bounds
_rate_, not _volume_: a client (or a crowd) staying politely under it can
burn ~14,000 requests a day, roughly $3.50/hour at Haiku prices,
indefinitely. There was no per-visitor volume limit and no global spend
guard of any kind.

Two constraints shape the fix. The spec's "simplicity before
infrastructure" rule (§3) bars KV, Durable Objects, and D1 without a
recorded concrete need, and ADR-0009 deliberately chose statelessness. And
a per-IP _daily_ counter would be the wrong tool even with storage:
LinkedIn traffic is heavily mobile behind carrier-grade NAT, where many
genuine visitors share one IP — a daily IP cap over-blocks exactly the
audience the demo exists for, while distributed clients rotate past it.

## Decision

Count questions **per browser** in a signed, HTTP-only cookie; allow
**10 questions per 24-hour window** (fixed window from the first
question). The counter lives in the visitor's cookie jar and the server
holds only an HMAC secret — the quota adds no stateful infrastructure.

- **Mechanism** (`src/lib/agent/quota.ts`): cookie `ask_quota` with value
  `v1.<windowStartSec>.<count>.<sig>`, HMAC-SHA-256 over the payload via
  Web Crypto, base64url signature, verified with `crypto.subtle.verify`.
  Attributes: `Max-Age=86400; Path=/api/ask; HttpOnly; SameSite=Strict`,
  plus `Secure` on the canonical host. Any missing, malformed, or
  tampered cookie degrades to a fresh window — the parser never rejects
  and never throws.
- **Placement**: after input validation and the IP limiter, before model
  selection. Denial is a plain JSON 429 with new error code
  `quota_exceeded` and friendly copy; it is decided before any stream
  opens, so ADR-0016's "SSE is always 200 once committed" invariant is
  untouched. The client already renders `error.message` from any non-OK
  response, so no island changes are needed.
- **Counting semantics**: count on acceptance. Refusals count (they are
  answered requests from the visitor's perspective) and upstream failures
  are not refunded — simple, and not worth gaming. Concurrent tabs can
  lose an increment to a race; the quota is approximate by one, in the
  same spirit as ADR-0009's documented approximation.
- **Configuration**: limit in the `ASK_QUOTA_LIMIT` var (default 10 in
  code); signing key in the `ASK_QUOTA_SECRET` Worker secret, following
  the ADR-0014 pattern. When the secret is absent the layer is skipped
  and logged (`ask.quota_skipped`), matching the rate-limiter-absent
  precedent — and `scripts/probe-live-security.ts` asserts the cookie on
  live responses after every deploy, so production cannot silently run
  without it. Rotating the secret merely resets visitor windows.
- **Disclosure**: the site's "no cookies" claim changed with the
  behaviour, in the same change (ADR-0023 precedent): /privacy describes
  the counter (a count, no identifier, Ask requests only), and the
  colophon — which feeds the agent corpus, so the assistant itself
  answers correctly — plus llms.txt and the threat model say the same.

## Alternatives considered

- **Server-side counters (KV / Durable Objects)**: accurate and
  clear-proof, but new stateful infrastructure against spec §3, and
  keyed by what? IP over-blocks NATed visitors; a cookie ID reduces to
  this design with extra moving parts. Rejected while the signed cookie
  plus global caps suffice.
- **Tighter IP limit**: cheap but wrong axis — it throttles bursts, not
  volume, and CGNAT makes daily IP budgets collectively punitive.
- **Turnstile**: stops scripted abuse, but needs CSP changes to the
  test-pinned `public/_headers` policy and its own ADR. Stays the
  documented escalation in docs/threat-model.md, unchanged.

## Consequences

- A visitor can clear cookies (or use curl) and look fresh. Accepted:
  the layer is fairness for honest browsers, not a security boundary —
  the IP limiter still bounds burst rate and the global spend guard
  (AI Gateway + provider spend limit, ADR-0025) bounds the wallet.
- `quota_exceeded` joins the closed error-code enums in
  `src/pages/api/ask.ts` and `src/lib/agent/schema.ts`; the error
  envelope shape is unchanged.
- Blocked-cookie browsers (some in-app webviews) are never denied by
  this layer — each request looks fresh. That is the chosen failure
  direction: fail open per-visitor, rely on the aggregate layers.
- Observability: `ask.quota_exceeded` events show per-visitor pressure;
  the twice-daily red-team run plus post-deploy probe alert if the
  cookie ever disappears from live responses.
- Revisit triggers: cookie-cleared abuse at volume (adopt Turnstile via
  its own ADR), or the limit proving too tight for genuine visitors
  (retune `ASK_QUOTA_LIMIT` — a var change, not a code change).
