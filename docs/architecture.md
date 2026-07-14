# Architecture

How edwardchapman.co.uk is put together, and why it looks the way it does.
Decisions with trade-offs live in [docs/adr/](adr/); this document is the map.

## System shape

```text
                    ┌──────────────────────────────────────────────┐
                    │              Cloudflare edge                 │
 GET /…       ──────▶  Static Assets (dist/client)  ── HTML/CSS ───▶
                    │  · html_handling: auto-trailing-slash        │
                    │  · not_found_handling: 404-page              │
                    ├──────────────────────────────────────────────┤
 POST /api/…  ──────▶  Worker (dist/server/entry.mjs)              │
                    │  · /api/health  (Phase 0)                    │
                    │  · /api/ask     (Phase 3)                    │
                    └──────────────────────────────────────────────┘
```

Static asset requests never invoke the Worker ([ADR-0003](adr/0003-static-first-rendering.md)).
The Worker exists only for routes that declare `prerender = false`.

## Build pipeline

`make build` runs two pre-build generators before `astro build`, in order:

1. **`scripts/build-agent-corpus.ts`** — the versioned agent corpus
   ([ADR-0005](adr/0005-build-time-corpus-deterministic-retrieval.md)).
2. **`scripts/build-og-cards.ts`** — per-page social cards (spec §9). It
   renders one 1200×630 PNG per non-draft project and note into
   `public/og/{projects,notes}/` (gitignored; `public/og/default.png` is the
   committed site-wide fallback). Rasterisation uses `@resvg/resvg-js`, a
   native module — it must run as a Node pre-build step because the Worker
   bundler can never see it.

Both are deterministic from published content, so CI and local builds emit
identical assets.

`astro build` (adapter: `@astrojs/cloudflare` v14, which wraps
`@cloudflare/vite-plugin`) then emits:

- `dist/client/` — prerendered pages and assets, served by Workers Static
  Assets. Includes an adapter-managed `_headers` file.
- `dist/server/` — the Worker bundle plus **`wrangler.json`**, a resolved,
  deploy-ready config derived from the repo's `wrangler.jsonc`.

Deploys therefore run `wrangler deploy --config dist/server/wrangler.json`.
The repo's `wrangler.jsonc` intentionally has **no `main`** — the adapter
injects its server entrypoint.

## Content model

Content is typed data, not loose markdown
([ADR-0001](adr/0001-astro-and-strict-typescript.md)):

| Collection | Purpose                                                                                 | Schema highlights                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `projects` | Project cards (Phase 1) + case-study bodies (Phase 2)                                   | card copy fields (`problem`, `built`, `differentiator`), `tech`, `repo`/`demo` URLs, `featured`, `order`, `draft` |
| `notes`    | Technical writing (Phase 2+)                                                            | `pubDate`/`updatedDate`, `tags`, `draft`, `canonicalURL`, `relatedProject`                                        |
| `profile`  | Prose the homepage/colophon render — positioning, how-I-work, technical focus, colophon | `order`, `corpus` (agent-ingestion opt-out)                                                                       |

Schemas are **pure zod** in [`src/lib/schemas.ts`](../src/lib/schemas.ts) —
no `astro:*` imports — so Astro's content layer, the Node check scripts, and
the Phase-3 corpus builder all share one definition.

### Stable-ID / section contract (corpus-facing)

The Phase-3 corpus ([ADR-0005](adr/0005-build-time-corpus-deterministic-retrieval.md))
derives `docId` from the collection entry id (file path) and `sectionId` from
markdown heading paths. **Renaming a content file or restructuring its
headings is a breaking corpus change** — retrieval fixtures must be updated
in the same PR.

### Public-content boundary

Published output = non-draft collection entries (+ `corpus: true` for agent
ingestion) + authored pages. The boundary is enforced mechanically by
`scripts/check-content-policy.ts` inside `make check`
([ADR-0007](adr/0007-public-content-boundary.md)).

## Quality gate

One command, everywhere: `make check` — run locally, by the pre-commit hook
(via the global dispatcher), by PR CI, and weekly on a schedule. It executes
markdown link/anchor checks, Prettier, ESLint, `astro check`, Vitest,
the production build, the content-policy scan, and built-output link/canonical
validation. Playwright e2e runs separately (`make test-e2e`) and in a
non-required CI job.

**Lighthouse budgets** are a second, non-blocking layer
([ADR-0010](adr/0010-lighthouse-budgets-and-early-rss.md)): `make check-perf`
runs `lhci autorun` against the built site with thresholds pinned in
`lighthouserc.json` (performance ≥ 0.85; accessibility, best practices and
SEO ≥ 0.95). CI runs it on every PR via `perf.yml`; like e2e it is
deliberately not a required check — it is not part of `make check` and does
not gate merges.

## Environment bindings

| Name                | Kind           | Introduced | Purpose                                                            |
| ------------------- | -------------- | ---------- | ------------------------------------------------------------------ |
| `ASSETS`            | assets binding | Phase 0    | static asset serving                                               |
| `ANTHROPIC_MODEL`   | var            | Phase 3    | model id for the agent (config-driven; default `claude-haiku-4-5`) |
| `ANTHROPIC_API_KEY` | secret         | Phase 4    | Anthropic credential (Worker secret; never client-side)            |
| rate-limit binding  | ratelimit      | Phase 3    | per-IP limiting on `/api/ask`                                      |

## URL policy

No trailing slashes (`trailingSlash: "never"`, `build.format: "file"`;
the asset layer 308-redirects `/x/` → `/x`). Canonical origin is
`https://edwardchapman.co.uk`; `www` 301s to the apex (zone redirect rule,
Phase 1). `scripts/check-internal-links.ts` enforces both properties on every
build.
