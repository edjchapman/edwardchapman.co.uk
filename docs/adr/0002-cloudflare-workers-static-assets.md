# ADR-0002: Cloudflare Workers with Static Assets (not Pages, not a server)

**Status:** Accepted (2026-07-10)

## Context

The previous incarnation of edwardchapman.co.uk died with its origin server —
the domain sat behind Cloudflare returning 521 because the box behind it went
away. The replacement must remove that failure mode structurally, host a
small dynamic API surface (`/api/health` now, `/api/ask` in Phase 3), and
keep deployment fully reproducible from CI. The zone is already on Cloudflare
nameservers.

## Decision

Cloudflare Workers with Static Assets, deployed by wrangler from GitHub
Actions. Prerendered pages are served from the asset layer without invoking
the Worker; only explicit `prerender = false` routes execute code. The
`@astrojs/cloudflare` adapter (v14, `@cloudflare/vite-plugin` based) emits a
deploy-ready config at `dist/server/wrangler.json`; deploys run
`wrangler deploy --config dist/server/wrangler.json`.

## Alternatives considered

- **Cloudflare Pages (+ Functions)** — explicitly excluded by the spec;
  Workers with Static Assets is Cloudflare's current recommended target for
  new projects, and one platform primitive beats two.
- **A persistent server (VPS/containers)** — reintroduces exactly the origin
  that died last time, plus patching and uptime obligations a personal site
  doesn't justify. Rejected.
- **Static-only host (GitHub Pages/Netlify)** — no first-class server-side
  surface for the Phase-3 agent on the same origin; would force a second
  deployment target later. Rejected.

## Consequences

- No origin server exists to die: static content is served from Cloudflare's
  edge, and the Worker is code, not infrastructure.
- The Worker runtime constrains Phase 3+ to Workers-compatible libraries
  (the Anthropic TypeScript SDK qualifies).
- Local production parity comes from `wrangler dev` against the emitted
  config rather than `astro preview`.
- Sessions are explicitly disabled (`driver: null` in astro.config.ts) so the
  adapter cannot auto-provision a KV namespace, per the spec's
  no-KV/DO/D1 rule.

## Revisit conditions

- A Phase-5 requirement (measured, per spec §18) needs storage or compute
  the Workers platform can't provide cleanly.
- Cloudflare pricing or platform direction changes materially.
