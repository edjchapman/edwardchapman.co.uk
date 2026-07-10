# ADR-0006: No vector database (or embeddings) initially

**Status:** Accepted (2026-07-10)

## Context

RAG defaults in 2026 assume an embedding index. This site's corpus is a
handful of pages — likely well under a hundred sections at Phase-3 launch —
written in consistent technical vocabulary by one author. The spec's
"simplicity before infrastructure" principle bans a vector database, KV,
Durable Objects, and D1 until a concrete requirement is recorded.

## Decision

Retrieval starts lexical and deterministic (ADR-0005). No embeddings, no
Vectorize, no external index. The `Retriever` interface is the seam where a
semantic implementation could later slot in.

## Alternatives considered

- **Cloudflare Vectorize from day one** — infrastructure, an embedding
  pipeline, and non-determinism in exchange for solving a recall problem we
  cannot yet observe at this corpus size. Rejected.
- **In-Worker embedding similarity (no external store)** — still requires an
  embedding step at build and model calls at query time; keeps determinism
  only partially; premature for the same reason. Rejected.

## Consequences

- Retrieval quality is fully explainable: a failing golden case points at a
  scoring function, not at opaque vectors.
- CI needs no secrets or network to evaluate retrieval.
- A real semantic-miss problem, if it appears, is measurable against a
  lexical baseline — which is exactly the comparison the spec demands before
  adopting Vectorize.

## Revisit conditions

Any of (with evidence recorded in a superseding ADR): golden retrieval tests
show meaningful semantic misses; the corpus outgrows reliable lexical
ranking; latency or prompt size becomes unreasonable; a measured comparison
shows an embedding index improves retrieval quality.
