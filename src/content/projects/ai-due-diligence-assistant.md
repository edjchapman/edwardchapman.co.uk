---
title: "AI Due-Diligence Assistant"
problem: "An evidence-first due-diligence system built to solve a fundamental problem with LLM-generated analysis: a finding is only useful when it can be traced back to a verifiable source."
built: "Built with Fastify and TypeScript, the service uses a stateful LangGraph.js agent to run structured checks across ingested company filings. Relevant evidence is retrieved from PostgreSQL with pgvector, and each finding in the final report includes a citation to the exact source chunk that supports it."
differentiator: "Evaluation is treated as part of the product, not an afterthought. A golden dataset is scored by an LLM-as-judge pipeline in CI on every push, helping detect regressions in retrieval quality, reasoning, and citation accuracy. A keyless demo mode also makes the complete system reproducible from a fresh clone using only Docker."
tech:
  - TypeScript
  - Node.js
  - Fastify
  - LangGraph.js
  - Claude
  - PostgreSQL
  - pgvector
featured: true
order: 2
draft: false
repo: "https://github.com/edjchapman/AI-Due-Diligence-Assistant"
demo: "https://dda.edwardchapman.co.uk"
---

## Context

Most engineers can call an LLM API. Fewer can show the _system_ around one:
grounded retrieval, an agent whose steps you can inspect, and a way to know —
objectively, on every commit — whether the answers are any good. This project
is that system, built around a concrete task: read a company's filings, board
minutes, and public commentary, and produce a due-diligence report a reviewer
could audit.

## Problem

Given a target company, run four due-diligence checks — revenue
concentration, related-party transactions, going-concern doubt, and auditor
change — and return a structured verdict (`flagged` / `clear` / `uncertain`)
per check with the source citations each verdict is grounded in. The hard
requirement isn't the generation; it's that a wrong or uncited answer must be
_detectable by machinery_, not by vibes.

## Constraints

- Quality had to be scored in CI on every push, without secrets and without a
  paid model call — which forced the provider architecture below.
- Every finding needed a citation back to a specific source chunk with its
  relevance score.
- The public demo had to run free and safe (no API keys exposed, no cost
  exposure) from a fresh clone with just Docker.

## Architecture

```text
Ingest CLI ─▶ Postgres + pgvector ─▶ Fastify API ─▶ LangGraph.js agent ─▶ Eval harness (in CI)
  (chunk + embed)  (cosine + HNSW)     (/search,      (node per check:       (golden set +
                                        /report)       retrieve → reason       LLM-as-judge)
                                                       → cite)
```

Documents are chunked, embedded, and stored in Postgres/pgvector; queries run
cosine top-k over an HNSW index, every result carrying its citation. The
agent is a LangGraph.js state graph with a node per check: retrieve
company-scoped evidence, reason a verdict (Claude via the Vercel AI SDK),
append a cited finding. The graph is the inspectable artefact.

## Important engineering decisions

- **The eval harness is the headline, and it gates the build.** The agent
  runs over reference companies and every finding is scored against a golden
  set by an LLM-as-judge, in CI, on every push. A regression in retrieval,
  scoping, the graph, or the golden set turns CI red.
- **Keyless, deterministic providers everywhere.** Embeddings, reasoning, and
  the judge each sit behind a provider switch (`EMBED_PROVIDER` /
  `LLM_PROVIDER` / `JUDGE_PROVIDER`): real providers in production,
  deterministic local stand-ins in tests, CI, and the public demo. That's
  what makes "evals in CI without secrets" possible at all.
- **A golden set with true negatives.** Three companies plus a clean control,
  authored so scoring has signal: "flag everything" scores 66%; only a system
  that correctly _clears_ the clean company — and reads a negated
  going-concern note as clear — reaches 100%.
- **A real extraction front-door.** A filing PDF is decoded keyless and flows
  through the same chunk → embed → retrieve pipeline; a structured-extraction
  stage reads typed fields (largest-customer %, related parties,
  going-concern doubt, auditor change), each with its evidence sentence, and
  a field-level precision/recall/F1 test scores the extractor in CI.

## Alternatives considered

A dedicated vector database (rejected: pgvector keeps one operational
surface); prompt-only quality control (rejected: unmeasurable); recording
real provider responses for CI (rejected in favour of deterministic
stand-ins, which don't rot silently); Amazon Textract for OCR-grade
extraction (documented as the swap-in for scanned filings — see the repo's
ADR 0002).

## Testing and quality approach

Strict TypeScript, type-checked ESLint, Prettier, and a `make check` gate
mirrored in CI and a pre-commit hook. The eval suite (12/12 on the golden
set) and the extractor's precision/recall/F1 test run keyless in CI.
`make demo` and `make eval` reproduce the whole thing end-to-end.

## Operational or deployment model

One Docker image deployed to Railway with a `/health` probe; the public demo
runs the keyless provider set by default (free and safe); public endpoints
are rate-limited (60 req/min/IP with `Retry-After`). AWS is documented as the
production target in the repo's ADR 0001.

## Outcome

A production-shaped LLM system whose quality is a CI property: cited
verdicts over real document structure, a reproducible demo, and an
evaluation loop that catches regressions before they ship. It's also the
public evidence base for how I approach AI engineering generally — the same
shape as production pipelines I've built professionally, re-expressed on
public data.

## Current limitations

- Four checks and a small authored corpus — breadth is deliberately traded
  for a scorable golden set.
- The LLM-as-judge inherits judge bias; the golden set's true negatives
  bound it but don't eliminate it.
- Scanned/OCR filings aren't handled (the Textract swap is documented, not
  built).

## What I'd do next

Grow the golden set alongside any new checks (the corpus was built for the
eval — that discipline holds); wire the documented Textract path for scanned
filings; add per-check confidence calibration against judge scores.

## Relevant links

- [Repository](https://github.com/edjchapman/AI-Due-Diligence-Assistant) —
  including the full
  [case study](https://github.com/edjchapman/AI-Due-Diligence-Assistant/blob/main/docs/case-study.md)
  and ADRs this page summarises
- [Live demo](https://dda.edwardchapman.co.uk)
