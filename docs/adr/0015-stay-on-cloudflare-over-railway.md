# ADR-0015: Stay on Cloudflare Workers rather than migrating to Railway

**Status:** Accepted (2026-07-15)

## Context

Two sibling personal projects are hosted on Railway, which raised the question
of whether this site should consolidate onto the same platform for a single
deployment model, or stay on Cloudflare. ADR-0002 chose Cloudflare Workers with
static assets; this ADR records the deliberate decision to keep it, so the "why
not Railway" reasoning sits on the record next to the original choice.

The two platforms optimise for opposite shapes. Railway is a PaaS for
long-running processes with managed stateful services (Postgres, Redis)
attached — it shines when an app is a persistent server with a database.
Cloudflare Workers is for stateless edge functions in front of static assets —
it shines when an app is mostly prerendered content plus thin request-time
logic.

This site is squarely the second shape, and several accepted ADRs are built on
it: pages are prerendered and served from the edge (ADR-0003, static-first;
ADR-0002, Workers static assets); only `/api/*` executes; `/api/ask` rate-limits
with Cloudflare's native binding specifically to avoid stateful infra (ADR-0009);
retrieval is a build-time corpus with no database (ADR-0006). There is no
persistent state anywhere in the design.

## Decision

Stay on Cloudflare Workers + static assets; do not migrate to Railway. The
current architecture, deploy pipeline (`wrangler` versioned deploys), and
edge-native primitives are retained unchanged.

The deciding axis is **stateless vs stateful**, not "which host is better." The
app has been deliberately engineered to hold no request-time state, so a
platform optimised for stateful long-running processes would be paying for
capabilities the design exists not to need, while regressing the ones it does.

## Alternatives considered

- **Migrate to Railway (Node server + managed Postgres/Redis).** Rejected now.
  It would mean swapping the `@astrojs/cloudflare` adapter for `@astrojs/node`,
  rewriting the `cloudflare:workers` env access and the entire versioned
  deploy/rollback/smoke pipeline, losing the global edge CDN (Railway serves
  from a single region unless fronted by a CDN), paying for always-on compute to
  serve a site that is almost entirely static files, and — most pointedly —
  reintroducing a rate-limit store (realistically Redis), i.e. the exact
  stateful infrastructure ADR-0009 was written to avoid. Honest points in its
  favour, recorded so the trade is explicit: Railway's env-var model is simpler
  (dashboard-set, auto-redeploy — no Cloudflare versioned-deploy two-step, the
  friction behind ADR-0014), and consolidating onto one platform as the sibling
  projects use would reduce operational surface. Neither outweighs the migration
  cost and the edge/cost/rate-limit regressions for a stateless static app.
- **Hybrid: static on a CDN, `/api/*` on Railway.** Rejected. It splits the
  deploy across two hosts, turns the same-origin API into a cross-origin one,
  and still needs a rate-limit store — added complexity with no payoff at this
  scale.
- **Another edge platform (Vercel / Netlify functions).** Out of scope. Same
  static-plus-edge model as Cloudflare with no advantage that would justify
  moving the incumbent, which already holds the zone's DNS and the custom domain
  (see the Phase 1 cutover in docs/deployment.md).

## Relations

Reaffirms ADR-0002 (Workers static assets) and ADR-0003 (static-first);
depends on ADR-0009 (infra-free rate limiting) and ADR-0006 (build-time corpus,
no vector database) as the load-bearing reasons the stateless model holds.
Complements ADR-0014: it acknowledges the Cloudflare-specific secret/
versioned-deploy friction as real, while noting `make rotate-anthropic-key`
mitigates it, so that friction is not on its own a reason to move.

## Consequences

- No migration work; the architecture, pipeline, and cost profile are unchanged
  — edge CDN, no cold starts, near-zero hosting cost, native rate limiting.
- The deployment model stays divergent from the sibling projects' Railway
  stack: one more mental model to hold, accepted because the apps differ in
  shape (stateless static vs stateful server).
- The Cloudflare-specific deploy/secret friction is accepted as the cost of the
  edge model, mitigated by tooling (ADR-0014) rather than by changing host.
- Should a future feature need persistence, the choice is reopened deliberately
  (see below) rather than drifted into.

## Revisit conditions

- The site gains persistent request-time state — a database, user accounts,
  persisted questions/analytics, background queues, or a real (served) vector
  index. At that point Railway's managed Postgres/Redis beside the app becomes a
  genuine fit; re-evaluate with a superseding ADR (weighing Cloudflare's own
  stateful primitives — D1, Durable Objects, Queues, Vectorize — against a
  Railway migration).
- The operational burden of Cloudflare-specific deploys and secrets comes to
  outweigh the edge and cost benefits despite the ADR-0014 tooling.
- Consolidating the personal projects onto one platform becomes a first-order
  goal in its own right, worth a migration the app's shape would not otherwise
  justify.
