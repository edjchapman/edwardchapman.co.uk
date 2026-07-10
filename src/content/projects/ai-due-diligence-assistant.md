---
title: "AI Due-Diligence Assistant"
problem: "LLM summaries of a target company's filings aren't trustworthy in due diligence unless every finding can be traced to a verifiable source."
built: "A Fastify/TypeScript service in which a stateful LangGraph.js agent runs structured due-diligence checks over ingested filings, retrieving from PostgreSQL/pgvector and producing an audit-grade report where each finding cites its source chunk."
differentiator: "The evaluation harness is part of the product: a golden set scored by LLM-as-judge runs in CI on every push, and a keyless demo mode makes the full system reproducible from a fresh clone with just Docker."
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
demo: "https://app-production-e60e.up.railway.app"
---

Case study to follow in Phase 2 (see docs/spec.md, delivery phases).
