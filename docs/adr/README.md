# Architecture decision records

Nygard-style ADRs, numbered in the order the decisions were made. Every ADR
records context, the decision, alternatives considered, consequences, and
revisit conditions. A decision that contradicts an accepted ADR requires a
superseding ADR, not silent drift (see CLAUDE.md); superseded entries would be
marked here and in their own status line.

| ADR                                                                     | Decision                                                                     | Status                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| [0001](0001-astro-and-strict-typescript.md)                             | Astro 7 with strict TypeScript                                               | Accepted 2026-07-10          |
| [0002](0002-cloudflare-workers-static-assets.md)                        | Cloudflare Workers with Static Assets (not Pages, not a server)              | Accepted 2026-07-10          |
| [0003](0003-static-first-rendering.md)                                  | Static generation by default; request-time execution by exception            | Accepted 2026-07-10          |
| [0004](0004-react-islands-only.md)                                      | React only for interactive islands — and none before Phase 3                 | Accepted 2026-07-10          |
| [0005](0005-build-time-corpus-deterministic-retrieval.md)               | Build-time corpus + deterministic retrieval behind an interface              | Accepted 2026-07-10          |
| [0006](0006-no-vector-database-initially.md)                            | No vector database (or embeddings) initially                                 | Accepted 2026-07-10          |
| [0007](0007-public-content-boundary.md)                                 | The public-content boundary                                                  | Accepted 2026-07-10          |
| [0008](0008-deterministic-and-live-evaluation-split.md)                 | Deterministic CI evaluation, live evaluation on demand                       | Accepted 2026-07-10          |
| [0009](0009-rate-limiting-without-stateful-infra.md)                    | Rate limiting via the Workers rate-limit binding                             | Accepted 2026-07-11          |
| [0010](0010-lighthouse-budgets-and-early-rss.md)                        | Lighthouse budgets in CI; RSS and social-card automation pulled forward      | Accepted 2026-07-14          |
| [0011](0011-cv-derived-positioning-via-reviewed-drafting.md)            | CV-informed positioning drafting, public-source claims only                  | Accepted 2026-07-14; amended |
| [0012](0012-api-enforced-citations-via-search-results.md)               | API-enforced citations via search-result blocks                              | Accepted 2026-07-14          |
| [0013](0013-dark-mode-via-prefers-color-scheme.md)                      | Dark mode via `prefers-color-scheme`, no toggle                              | Accepted 2026-07-15          |
| [0014](0014-anthropic-key-management.md)                                | Centralise Anthropic key rotation as one command, not one store              | Accepted 2026-07-15          |
| [0015](0015-stay-on-cloudflare-over-railway.md)                         | Stay on Cloudflare Workers rather than migrating to Railway                  | Accepted 2026-07-15          |
| [0016](0016-streaming-answers-with-incremental-validation.md)           | Streaming answers with incremental output-control validation                 | Accepted 2026-07-15          |
| [0017](0017-structured-data-jsonld-graph.md)                            | Structured data via a single JSON-LD `@graph`                                | Accepted 2026-07-20          |
| [0018](0018-fail-closed-model-selection-and-secret-safe-builds.md)      | Fail closed on missing model credentials and strip local secrets from builds | Accepted 2026-07-20          |
| [0019](0019-published-career-history-via-linkedin-source.md)            | Published career history, sourced from the public LinkedIn profile           | Accepted 2026-07-21          |
| [0020](0020-motion-elevation-and-css-view-transitions.md)               | Motion and elevation vocabulary, CSS-only view transitions                   | Accepted 2026-07-24          |
| [0021](0021-self-hosted-display-serif.md)                               | One self-hosted display serif via the fonts API                              | Accepted 2026-07-24          |
| [0022](0022-published-availability-surface.md)                          | A published availability surface, corpus-included and Ed-affirmed            | Accepted 2026-07-24          |
| [0023](0023-record-questions-for-abuse-monitoring.md)                   | Record submitted questions in operational logs for abuse monitoring          | Accepted 2026-07-25          |
| [0024](0024-per-visitor-question-quota-via-signed-cookie.md)            | Per-visitor question quota via a signed cookie                               | Accepted 2026-07-25; amended |
| [0025](0025-ai-gateway-and-provider-spend-limit.md)                     | Global spend guard — Cloudflare AI Gateway + Anthropic provider spend limit  | Accepted 2026-07-28          |
| [0026](0026-upstream-failure-taxonomy-and-honest-degraded-responses.md) | Upstream failure taxonomy and honest degraded responses                      | Accepted 2026-07-28          |
| [0027](0027-pre-answered-baseline-questions.md)                         | Pre-answered baseline questions served without a model call                  | Accepted 2026-07-28          |

Reading order for newcomers: 0001–0003 set the platform shape, 0005–0008 define
the agent's grounding and evaluation model, 0007/0011/0019 govern what content
may exist at all.
