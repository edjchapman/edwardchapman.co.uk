---
title: "Retrieval without a vector database"
description: "The lexical retrieval baseline behind this site's ask agent: deterministic BM25-style scoring, a confidence gate, refusal behaviour, and the evidence required before adding embeddings."
pubDate: 2026-07-13
tags:
  - ai-engineering
  - retrieval
  - architecture
draft: false
---

Embeddings are one way to retrieve context for grounded question answering,
but they are not required for every corpus. This site's published corpus is
small, deliberately authored, and uses consistent technical vocabulary. A
deterministic lexical baseline is therefore easier to inspect and evaluate
before introducing an embedding model or external index.

The decision and its revisit conditions are recorded in
[ADR-0005](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/adr/0005-build-time-corpus-deterministic-retrieval.md)
and
[ADR-0006](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/adr/0006-no-vector-database-initially.md).
The implementation is in the public
[retrieval module](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/src/lib/agent/retrieval.ts).

## Lexical retrieval pipeline

At build time, non-draft project and note entries plus approved profile entries
are split at level-two Markdown headings. Each section receives a document ID,
section ID, title, canonical URL, tags, and text.

At request time the retriever:

1. **Tokenises** the question by lowercasing, removing punctuation and
   stopwords, and folding simple plurals.
2. **Expands known terms** through a small, curated synonym map. The map
   handles vocabulary used by this corpus, such as `postgres` → `postgresql`; it is
   not a general semantic model.
3. **Scores sections** with a BM25-style calculation: inverse document
   frequency, term-frequency saturation, length normalisation, and a boost for
   title, tag, and document-ID matches. The underlying BM25 model is described
   in the
   [Stanford Introduction to Information Retrieval](https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html).
4. **Limits sections per document** so one long page cannot occupy every
   context position when a question needs evidence from several sources.

The implementation is deterministic and runs against versioned
[retrieval cases](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/tests/agent/retrieval-cases.json)
in CI. Those fixtures assert expected ranking and refusal behaviour without a
network call or provider key.

## Refusal gate

Retrieval produces both an ordering and a confidence signal. The current gate
requires a minimum score and at least two matched query terms. It also has a
stricter exception for a strong single-term document-identity match, which
allows questions such as "What is Foreman?" without accepting generic
single-term questions.

If the result does not meet the gate, the model is not called. The service
returns the documented refusal instead of asking the model to answer from weak
context. The thresholds and representative boundary cases are recorded in
[docs/evaluation.md](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/evaluation.md).
Changing a threshold will fail CI when it changes one of the covered expected
outcomes; review policy also requires the rationale for the change to be
documented.

This gate cannot prove that every accepted result is relevant. It reduces a
known class of weak-context answers and makes the remaining errors measurable
through golden and live evaluation.

## Criteria for adding embeddings

The architecture records four reasons to reconsider the lexical baseline:

- golden cases show semantic misses that a reviewed synonym map cannot resolve;
- corpus growth reduces lexical precision or makes ranking too expensive;
- latency or prompt size becomes unreasonable; or
- an evaluation on the same cases shows that an embedding-based retriever
  improves retrieval quality enough to justify its operational cost.

The comparison should use the existing query-to-section fixtures. That keeps
the decision tied to observed retrieval behaviour rather than to a preferred
technology.

## Limitations

Lexical retrieval depends on shared vocabulary. A question expressed entirely
with concepts absent from the corpus may receive a low score even when a human
can infer the relationship. The curated synonym map covers known cases but does
not generalise beyond them.

The confidence score is also a heuristic, not a calibrated probability. Its
value comes from the tested decision boundary: which representative questions
are answered and which are refused.

## Practical starting point

For a bounded corpus, establish a lexical baseline before choosing additional
infrastructure:

1. create stable chunks with source metadata;
2. implement a transparent ranking function;
3. define explicit refusal behaviour; and
4. write answerable and should-refuse retrieval cases.

Use failures in those cases to decide whether synonym changes, scoring changes,
or semantic retrieval are warranted.
