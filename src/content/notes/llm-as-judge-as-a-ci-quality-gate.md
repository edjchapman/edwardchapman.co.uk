---
title: "LLM-as-judge as a CI quality gate"
description: "A practical evaluation pattern for LLM systems: versioned golden cases, deterministic CI checks, separate live-model evaluation, and explicit limits for automated judges."
pubDate: 2026-07-11
tags:
  - ai-engineering
  - evaluation
  - ci
relatedProject: ai-due-diligence-assistant
---

LLM output cannot usually be checked with exact string assertions. It can still
be evaluated against versioned expectations, provided the evaluation separates
deterministic system behaviour from the variable behaviour of a live model.

The
[AI Due-Diligence Assistant](https://edwardchapman.co.uk/projects/ai-due-diligence-assistant)
uses this pattern for a concrete task: producing structured, cited findings
from company documents. Its public
[case study](https://github.com/edjchapman/AI-Due-Diligence-Assistant/blob/main/docs/case-study.md)
documents the golden set, provider interfaces, and CI evaluation harness.

## Evaluation gate structure

The gate has three parts:

1. **A golden set** — representative inputs with expected outcomes, versioned
   alongside the code. Each case should identify the behaviour that matters,
   such as the expected verdict, required evidence, or correct refusal.
2. **A judge** — a function that compares the actual output with the expected
   outcome. Exact matching may work for schemas and identifiers; generated
   prose often needs semantic comparison, which can be provided by an LLM
   judge in live evaluation.
3. **An acceptance threshold** — a documented minimum that determines whether
   the evaluated change can proceed. The threshold should reflect product risk
   and observed variance, rather than an arbitrary target.

This structure makes the evaluation result reviewable: a failed case points to
a specific input, expected outcome, and measured behaviour.

## Why true negatives matter

A useful golden set needs both positive and negative cases. If every reference
case expects a finding, a system that flags every document can appear accurate
without distinguishing relevant evidence from irrelevant evidence.

The AI-DDA fixture set includes a clean control company and a deliberately
negated going-concern statement. In the published scoring example, a
flag-everything strategy reaches 66%; correctly clearing the negative cases is
required to reach 100%. Those figures come from the authored fixture set, not
from a claim about general model performance.

Negative cases should represent real failure modes: absent evidence, negated
language, out-of-scope documents, and inputs for which the correct result is
"nothing to report".

## Deterministic checks and live evaluation

A required pull-request check should be reproducible and should not depend on a
paid external call. Provider interfaces allow CI to use deterministic stand-ins
for embeddings, reasoning, and judging while production uses the configured
providers.

Deterministic evaluation can verify retrieval results, document scoping,
schemas, citation identifiers, error handling, and known decision boundaries.
It cannot establish that the current live model produces high-quality prose.
That requires a separate live evaluation using the production adapter and a
recorded model configuration.

This site uses the same split for its ask agent:
[deterministic checks](https://github.com/edjchapman/edwardchapman.co.uk/tree/main/tests/agent)
run on every pull request, while
[live evaluation](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/evaluation.md)
runs on a schedule and before an agent release.

## What the gate can detect

The evaluation cases can expose regressions outside the model itself, including:

- retrieval changes that stop returning the expected evidence;
- scoping errors that mix documents from different entities;
- prompt or schema changes that break citation output;
- fixture edits that remove an important negative case; and
- provider changes that alter live answer quality.

Keeping these dimensions visible makes the failure easier to diagnose than a
single aggregate score.

## Limitations

An LLM judge can favour fluent language and still accept an unsupported answer.
Negative cases reduce that risk but do not remove it. Judge decisions need
periodic human review, and high-risk claims may need deterministic evidence
checks in addition to semantic scoring.

A golden set also reflects the system at the time it was written. New
capabilities, sources, and refusal boundaries need corresponding cases. Without
that maintenance, the gate continues to test an older definition of the
product.

## Practical starting point

Start with a small set that covers one expected success, one absence of
evidence, one negation, and one malformed or out-of-scope input. Record the
expected outcome and the reason it matters. Run those cases deterministically
in CI, then add a separate live-model evaluation for the behaviour that cannot
be established without a real provider.
