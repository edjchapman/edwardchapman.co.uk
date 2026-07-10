# ADR-0005: Build-time corpus + deterministic retrieval behind an interface

**Status:** Accepted (2026-07-10) — implementation lands in Phase 3

## Context

The "ask" agent must answer exclusively from published site content (spec
§10–11). That grounding is only auditable if the material the model sees is a
deterministic artefact with stable provenance — not a live query against
mutable state.

## Decision

At build time, `scripts/build-agent-corpus.ts` reads the published content
collections (via the shared schemas in `src/lib/schemas.ts`), excludes drafts
and `corpus: false` entries (ADR-0007), splits entries into sections at
markdown heading boundaries, and emits a versioned `corpus.json` whose chunks
carry `{docId, sectionId, title, url, type, tags, text, contentHash}`. The
artefact is imported into the Worker bundle — never served as a public asset.

**Stable-ID contract:** `docId` is the collection entry id (derived from the
file path); `sectionId` appends the heading path. Renaming a content file or
restructuring headings is a breaking corpus change and must update retrieval
fixtures in the same PR.

At request time, retrieval is deterministic lexical scoring (normalised
token matching, BM25-style weighting, boosted titles/tags, a small curated
synonym map) behind a `Retriever` interface, with an explicit confidence
threshold below which the agent refuses rather than improvises.

## Alternatives considered

- **Embeddings + vector store from day one** — rejected; see ADR-0006.
- **Retrieval over rendered HTML** — couples the corpus to presentation
  markup; the collections are already clean structured text. Rejected.
- **No retrieval (stuff the whole corpus into the prompt)** — tempting at
  this corpus size, but it removes the refusal signal (retrieval confidence)
  the spec requires, grows cost linearly with content, and gives citations no
  anchor. Rejected — though the corpus stays small enough that this remains
  the fallback benchmark for Phase-5 comparisons.

## Consequences

- Grounding is testable in CI with zero network: golden retrieval cases pin
  query → expected section IDs.
- Citations returned to users are whitelisted against the exact passages
  supplied to the model.
- Content edits change the corpus only through a rebuild, so every deployed
  answer is traceable to a commit.

## Revisit conditions

- Golden retrieval tests expose semantic misses lexical scoring can't close,
  corpus size makes lexical ranking unreliable, or prompt size/latency grow
  unreasonable — then ADR-0006's evidence bar applies.
