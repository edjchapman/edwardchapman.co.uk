# ADR-0012: API-enforced citations via search-result blocks

**Status:** Accepted (2026-07-14)

## Context

The ask agent's citations are model-claimed: the model returns a structured
JSON completion (`{answer, citations: string[]}`) and the service whitelists
the claimed sectionIds against the passages it supplied. That whitelist
catches _fabricated_ ids, but not _miscredited_ ones — the model can attach a
supplied id to a sentence that id does not support, and nothing downstream can
tell. The public contract also cannot say which part of an answer a source
supports, so the UI shows a flat source list. Separately, the Anthropic
adapter (request construction, response parsing, provider-error mapping) has
no deterministic test coverage; every other layer of the agent does.

The Messages API now attaches citations at generation time: passages sent as
`search_result` content blocks (with `citations: {enabled: true}`) come back
referenced by index from the answer's own text blocks, with `cited_text`
guaranteed verbatim from the supplied block. Citations become a property the
API enforces rather than a claim the model makes.

## Decision

Ground the agent with API-enforced citations:

- Each retrieved chunk is sent as a `search_result` content block —
  `source` = the chunk's canonical URL, `title` = the chunk title, content =
  the chunk text — with citations enabled on every block, followed by the
  framed question as a separate text block. The typed separation of evidence
  and question replaces the XML `<documents>` wrapper.
- The model-adapter seam normalises provider output to
  `{text, citations: [{start, end, documentIndex}]}` — character spans into
  the assembled answer, indexed against the supplied passages. Spans are
  block-granular: the minimal citable unit is the response text block, so a
  span covers the contiguous grounded segment, not a minimal quote. The fake
  adapter speaks the same type, so the deterministic suite exercises the full
  pipeline.
- The service keeps its defence-in-depth checks: an index-bounds citation
  whitelist (now an anomaly tripwire — it should never fire live), policy-leak
  fingerprints, exact-refusal detection, and zero-citations ⇒ refusal.
- The public contract gains per-claim spans:
  `citations: [{start, end, sourceIndex}]` alongside the existing sources
  list, and the `/ask` island renders inline source markers.

## Alternatives considered

- **Keep structured outputs on the answer path** — the API rejects citations
  and `output_config.format` in the same request, and of the two, enforced
  grounding is the one this agent exists to demonstrate. The LLM-judge in the
  live evaluation harness keeps structured outputs (separate request,
  unaffected). Rejected for the answer path.
- **Streaming responses** — the service validates the complete answer
  (structural schema, citation whitelist, leak fingerprints, refusal
  detection) before a byte reaches the client (spec §10 output controls).
  Streaming would emit text ahead of validation; buffering server-side until
  validation completes is not streaming. Answers are short (≤1024 tokens,
  concise by policy), so the latency win is small and the invariant is
  load-bearing. Rejected.
- **Prompt caching** — the stable prefix (system policy, ~350 tokens) is far
  below the 4096-token cache minimum for the configured model, and the first
  varying bytes (retrieved blocks differ per question) sit immediately after
  it; a cache write would never be read. Revisit if the stable prefix grows
  past the minimum or the design moves to a shared full-corpus prefix (the
  ADR-0005 fallback benchmark), where caching would apply.
- **`document` blocks with custom content** — workable (`citations` come back
  as `content_block_location`), and retained as the recorded contingency if
  `search_result` support regresses for the pinned model. `search_result`
  chosen because its `source`/`title` semantics match per-chunk canonical
  URLs exactly. The seam confines any such switch to the Anthropic adapter.

## Relations

Amends ADR-0005: the citation whitelist moves from sectionId-string matching
to index bounds over API-attached citations; the build-time corpus, stable-ID
contract, and retrieval design are untouched. Complements ADR-0008: the
deterministic suite gains true adapter coverage (stubbed transport, real SDK
serialisation and error taxonomy). Supersedes neither.

## Consequences

- Hallucinated citation _targets_ become inexpressible: a citation can only
  reference a block the service supplied, and its `cited_text` is verbatim
  from that block. The residual grounding risk narrows to miscontextualised
  or uncited claims — uncited answers already refuse, and live groundedness
  judging (ADR-0008) covers the rest.
- Per-claim provenance is part of the public contract; the UI can show which
  sentence rests on which source.
- A citation strip in production logs (`ask.citations_stripped`) becomes an
  anomaly signal rather than routine hygiene.
- The prompt no longer embeds sectionIds; passage identity travels in typed
  block fields, and the answer-side mapping is by index.
- Live verification pending: after deployment, a live evaluation run and a
  red-team re-run (the prompt changed) must be recorded here, ADR-0009 style.

## Revisit conditions

- The pinned model rejects `search_result` blocks — switch the adapter to the
  `document`-block contingency above.
- Citation span granularity (block-level) proves too coarse for the UI —
  evaluate sentence-level chunking of corpus sections against retrieval
  quality before changing the response contract.
