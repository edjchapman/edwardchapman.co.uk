---
title: "Retrieval without a vector database"
description: "Grounded Q&A doesn't start with embeddings. How this site's ask agent runs on BM25, a confidence gate, and refusal-first design — and the evidence bar a vector index would have to clear."
pubDate: 2026-07-13
tags:
  - ai-engineering
  - retrieval
  - architecture
draft: false
---

Every retrieval-augmented system I see starts the same way: pick a vector
database, pick an embedding model, then work out what the product was. That
ordering is backwards. Retrieval exists to put the _right evidence_ in front
of the model — and for a bounded, well-authored corpus, the boring lexical
option does that measurably well, with no index to operate, no embedding
drift, and full explainability of every ranking decision.

The [ask agent on this site](https://edwardchapman.co.uk/ask) answers
questions from published site content only. Its retrieval layer is a few
hundred lines of TypeScript in the
[public repository](https://github.com/edjchapman/edwardchapman.co.uk), and
that's the point: you can read the whole ranking function.

## What the lexical baseline actually is

At build time, published pages are split at heading boundaries into stable,
addressable chunks — each with a document ID, section ID, title, and
canonical URL. At request time:

1. **Tokenise** the question: lowercase, strip punctuation, drop stopwords,
   fold trivial plurals.
2. **Expand** through a small curated synonym map (`k8s → kubernetes`,
   `reliable → outbox, idempotent`) — a dozen entries beats a semantic model
   when you authored the corpus and know its vocabulary.
3. **Score** with BM25: term-frequency saturation, length normalisation, and
   a boost when the term appears in a title, tag, or document ID.
4. **Cap per document** so one long page can't flood every context slot —
   synthesis questions need evidence that spans documents.

Deterministic, versioned with the content, and testable in CI as plain
fixtures: _this query must surface this section_. No network, no key, no
flakiness.

## The load-bearing part is the refusal gate

The retrieval score isn't just a ranking — it's the system's confidence
estimate, and the agent treats low confidence as a hard stop. Below
threshold, the model is never called; the user gets an explicit "I don't
have published material on that" instead of an improvisation over weak
evidence. Grounding failures in RAG systems are usually blamed on the model,
but most of them are retrieval failures the pipeline silently forgave.

Gate design is where the actual tuning effort went. A single shared word
must never count as confident (a city name appearing once in prose does not
qualify the system as a local guide), so confidence requires
both a minimum score and multiple matched terms — with one carve-out for
definitional questions like "What is Foreman?", where the only meaningful
token is the subject itself and the match lands on a document's own
identity. Every one of those boundary decisions is pinned by a fixture, and
changing a threshold without changing the fixtures fails the build.

## The evidence bar for embeddings

The vector index stays out until one of these is observed, not imagined:

- Golden retrieval tests expose **semantic misses** — questions phrased in
  vocabulary the corpus doesn't share, failing against lexical ranking.
- The corpus **outgrows** lexical retrieval's precision.
- Latency or prompt size becomes unreasonable.
- A measured comparison shows an embedding index beats the baseline on the
  same fixtures.

That decision is recorded as an architecture decision record with explicit
revisit conditions. The day a vector database earns its way in, the golden
fixtures that justified it become the regression suite that keeps it honest.

## Honest limitations

Lexical retrieval is literal. It handles a curated synonym map's worth of
vocabulary drift and nothing more; a question phrased entirely in concepts
the corpus never names will under-score and refuse, even when a human could
see the connection. For a small corpus that failure mode is acceptable —
refusing is the designed behaviour when evidence is thin — but it is a real
ceiling, and it's exactly what the golden-set misses are there to detect.

## Where to start

If you're building grounded Q&A over content you control: chunk at heading
boundaries, score with BM25 plus a title boost, wire a refusal threshold,
and write ten retrieval fixtures before you write a prompt. You'll ship
something explainable this week — and you'll have the measurement harness
that tells you if you ever actually need the vector database.
