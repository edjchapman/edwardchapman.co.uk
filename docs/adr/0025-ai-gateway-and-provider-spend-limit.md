# ADR-0025: Global spend guard — Cloudflare AI Gateway + Anthropic provider spend limit

**Status:** Accepted (2026-07-28)

## Context

ADR-0024 (per-visitor quota) bounds how many questions one browser can ask, and
ADR-0009 (per-IP rate limit) bounds burst rate — but neither bounds the
**wallet**. ADR-0024:79 named this gap explicitly and reserved this ADR for it:
"the global spend guard (AI Gateway + provider spend limit, ADR-0025) bounds the
wallet." The 2026-07-25 LinkedIn spike drained the Anthropic API credit outright,
which is the failure the per-visitor quota can only slow (many distinct
visitors, or cookie-clearing clients, still add up).

Two things were missing: a **global** ceiling on request volume independent of
who is asking, and a hard cap on spend at the provider so a runaway can't drain
the account. The `ANTHROPIC_BASE_URL` binding has been plumbed end-to-end since
Phase 4 (spec §2, "AI Gateway where practical") for exactly this, unused until
now.

## Decision

Route the Anthropic adapter through **Cloudflare AI Gateway**, and set a hard
**spend limit** on the Anthropic side. Two layers, different jobs:

- **AI Gateway (`edwardchapman-ask`)** — the Worker's Anthropic calls go to the
  gateway URL (`ANTHROPIC_BASE_URL`), which forwards to the Anthropic API. It
  adds a **global rate limit** (100 requests/hour, sliding) across all callers —
  a ceiling the per-IP and per-visitor layers can't provide — plus request/cost
  **observability** (a dashboard of volume, latency, and spend). The gateway is
  **authenticated**: the Worker sends a `cf-aig-authorization: Bearer <token>`
  header (`ASK_AI_GATEWAY_TOKEN`), so the gateway URL alone can't be abused.
- **Anthropic Console spend limit** — a workspace monthly cap plus a lower alert
  threshold. This is the actual wallet bound: even if every other layer is
  bypassed, spend stops at the cap. The gateway limits _rate_; only the provider
  limit caps _money_.

Implementation is deliberately small — the seam already existed:

- `src/lib/agent/anthropic-adapter.ts` — `AnthropicAdapterConfig` gains an
  optional `gatewayToken`; when set, the SDK client sends the
  `cf-aig-authorization` header. Absent ⇒ no header, so the direct API path is
  byte-for-byte unchanged.
- `src/pages/api/ask.ts` — `AskEnv` gains `ASK_AI_GATEWAY_TOKEN`; the route
  passes it through. `ANTHROPIC_BASE_URL` was already read.
- **Activation is runtime, not a code change.** `ANTHROPIC_BASE_URL` and
  `ASK_AI_GATEWAY_TOKEN` are **Worker secrets** (set with the versioned
  two-step, like `ANTHROPIC_API_KEY`), not committed vars. Merging this PR is
  inert — the gateway turns on only once both secrets are set, and reverts to
  the direct API by removing them. No redeploy risk, fully reversible.

## Alternatives considered

- **Provider spend limit alone (no gateway).** Rejected: it caps money but gives
  no global rate ceiling and no per-request observability — the gateway is the
  only place to see and shape traffic before it becomes spend.
- **Gateway alone (no provider limit).** Rejected: the gateway limits rate, not
  total money; a sustained-but-under-limit stream still spends. The provider cap
  is the hard wallet stop.
- **A Worker-side global counter (KV/DO).** Rejected: reintroduces the stateful
  infrastructure spec §3 / ADR-0009 avoid; the gateway provides the global limit
  as managed infrastructure with no new binding.
- **Unauthenticated gateway.** Rejected: the gateway URL would be a public
  proxy to the Anthropic key's budget. The `cf-aig-authorization` token keeps it
  usable only by the Worker.

## Consequences

- A global 100 req/hr ceiling and a hard monthly spend cap — the 2026-07-25
  drain is bounded at the wallet, not just slowed per-visitor.
- Cost/volume/latency are observable in the gateway dashboard, closing the spec
  §14 "diagnose unexpected cost growth" gap that had no data source before.
- One more hop in the request path; the gateway's own failures surface through
  the existing taxonomy — a gateway 429 maps to `rate_limited` and a gateway
  outage to the `provider_error`/`timeout` classes (ADR-0026) with no new code.
- Two more Worker secrets to manage (documented in deployment.md alongside the
  key-rotation runbook); losing the gateway token fails closed to the honest
  `upstream_unavailable`, not a silent bypass.

## Relations

Completes the cost-control work ADR-0024 forward-referenced. Sits beside
ADR-0009 (per-IP rate) and ADR-0024 (per-visitor quota) as the third, global
layer. Its failure modes ride ADR-0026's taxonomy. Uses the `ANTHROPIC_BASE_URL`
seam recorded in spec §2 and ADR-0012.

## Revisit conditions

- Sustained legitimate traffic approaches 100 req/hr → raise the gateway limit
  and re-baseline the provider cap.
- AI Gateway gains prompt/semantic caching that fits this workload (each request
  differs today, so caching is not why we adopt it — ADR-0012) → reconsider
  caching there.
