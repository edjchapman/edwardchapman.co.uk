---
title: "Citations the model can't fake"
description: "Upgrading this site's ask agent from model-claimed citations to API-enforced citation spans: the decision record, the adapter seam that made it a contained change, and the tests that prove it without a network."
pubDate: 2026-07-14
tags:
  - ai-engineering
  - grounding
  - citations
  - evaluation
draft: true
---

The ask agent on this site answers questions from a build-time corpus of
published pages, and every answer must cite its sources. Until this week,
those citations were **model-claimed**: the model returned a structured JSON
completion — `{answer, citations: [...sectionIds]}` — and the service
whitelisted the claimed ids against the passages it had supplied.

That whitelist catches a _fabricated_ citation. It cannot catch a
_miscredited_ one. Nothing stopped the model from attaching a real, supplied
sectionId to a sentence that passage does not support — the weakest link in
an otherwise mechanical grounding chain.

## The decision

The Anthropic Messages API attaches citations at generation time: passages
sent as `search_result` content blocks (with `citations: {enabled: true}`)
come back referenced by index from the answer's own text blocks, with
`cited_text` guaranteed verbatim from the supplied block. A citation stops
being a claim the model makes and becomes a property the API enforces —
fabricated citation targets are not expressible.

The trade-offs were real enough to record in an ADR rather than a commit
message:

- **Structured outputs had to go from the answer path.** Citations and JSON
  output constraints are mutually exclusive per request, and of the two,
  enforced grounding is the one this agent exists to demonstrate. (The
  LLM-judge in the evaluation harness keeps structured outputs — separate
  request, unaffected.)
- **Streaming stayed rejected.** The service validates the complete answer —
  span structure, citation bounds, policy-leak fingerprints, refusal
  detection — before a byte reaches the client. Streaming would emit text
  ahead of validation, and answers are short; the invariant is worth more
  than the latency.
- **Prompt caching stayed rejected.** The stable prefix is ~350 tokens
  against a 4096-token cache minimum for the configured model, and the
  retrieved blocks vary per question immediately after it. A cache write
  that is never read is just a surcharge.

## The seam did the heavy lifting

The service never talked to the Anthropic SDK directly; it talks to a
`ModelAdapter` interface with a deterministic fake on the other side for CI.
The upgrade changed what crosses that seam: instead of raw JSON for the
service to parse, adapters now return a normalised answer —

```ts
type ModelAnswer = {
  text: string;
  citations: { start: number; end: number; documentIndex: number }[];
};
```

— character spans into the assembled answer, indexed against the supplied
passages. The Anthropic adapter does the provider-specific work (search-result
blocks out, citation locations in); the fake fabricates the same shape. Every
defence-in-depth check survived the mechanism swap: the citation whitelist
became an index-bounds tripwire that should never fire live (its log event now
signals an anomaly, not hygiene), the leak fingerprints and the
zero-citations-means-refusal rule are untouched.

The public contract gained per-claim provenance —
`citations: [{start, end, sourceIndex}]` — and the answer UI renders inline
markers by index arithmetic over the plain answer string. No model output is
ever treated as markup.

## Tests before belief

The part of the pipeline that talks to the real API had no deterministic
tests — everything around it did. The fix was to stub the _transport_, not
the SDK: the adapter accepts an injected `fetch`, so the real SDK still
performs request serialisation and typed-error classification, and the tests
assert the exact wire body (blocks in order, citations enabled on all, no
output constraint), the span normalisation (multi-block assembly, whitespace
trimming, index mapping), and the retry-aware error taxonomy (timeout, 429,
500, 400) — no network, no key.

The first live run after the change earned its keep in a different way: every
model call failed, and the report could not say _why_ — the harness recorded
outcomes but not failure classes. That gap is now closed (case results carry
a content-free status + error type), and the failure turned out to be an
expired credential, not the new mechanism. An evaluation harness that cannot
distinguish an infrastructure failure from a quality regression will
eventually launder one as the other.

## What did not change

The retrieval design (lexical BM25, confidence gate, refusal below it), the
corpus boundary (published, non-draft content only), the frozen evaluation
thresholds, and the refusal sentence are all exactly as they were. The
release verification is the same gate as ever: deterministic suite green,
live evaluation over the thresholds, red-team re-run because the prompt
changed. Grounding mechanisms are replaceable; the evidence bar is not.
