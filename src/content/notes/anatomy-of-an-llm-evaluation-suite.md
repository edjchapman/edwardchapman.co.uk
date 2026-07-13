---
title: "Designing an LLM evaluation suite"
description: "How to separate retrieval, groundedness, completeness, citation validity, refusals, and adversarial behaviour into measurements that identify the source of a regression."
pubDate: 2026-07-13
tags:
  - ai-engineering
  - evaluation
draft: false
---

A single evaluation score can show that overall behaviour changed, but it does
not identify the cause. A lower score might come from retrieval, unsupported
claims, missing information, invalid citations, or refusal behaviour. Measuring
those dimensions separately makes a failed evaluation actionable.

The worked example is this site's
[ask agent](https://edwardchapman.co.uk/ask). Its
[fixtures](https://github.com/edjchapman/edwardchapman.co.uk/tree/main/tests/agent),
[live evaluation runner](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/scripts/run-agent-evals.ts),
and
[recorded thresholds](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/evaluation.md)
are public.

## Evaluation dimensions

The suite measures six related behaviours:

1. **Retrieval relevance** — did the expected sections appear for the query?
   This can be tested deterministically from query-to-section fixtures.
2. **Groundedness** — is each factual statement in the answer supported by
   the supplied passages?
3. **Completeness** — does the answer include the required claims? A fully
   grounded answer can still omit important information.
4. **Citation validity** — do citation identifiers refer to passages that were
   supplied to the model? This site enforces membership with a whitelist.
   Whether a cited passage supports a particular claim remains part of the
   groundedness assessment.
5. **Refusal accuracy** — does the system refuse questions that the published
   corpus cannot support without refusing answerable questions unnecessarily?
6. **Adversarial behaviour** — how does the system respond to prompt
   injection, role-change requests, private-data requests, and unrelated
   questions? Automated checks are supplemented by a manual red-team review.

These dimensions need to be interpreted together. For example, increasing
completeness is not an improvement if groundedness falls, and a grounded model
cannot compensate for retrieval that omitted the relevant source.

## Setting and maintaining thresholds

Thresholds should combine two forms of evidence:

- the minimum behaviour required by the product and its risk profile; and
- repeated baseline runs showing the normal variance of the measurement.

A baseline is descriptive, not automatically acceptable. If the current
system performs below the product requirement, the threshold should expose the
gap rather than redefine it as success. For stochastic judge scores, repeated
runs help establish enough tolerance to avoid treating ordinary judge variance
as a regression.

Once agreed, thresholds should be recorded with their baseline and rationale.
Changing one should require an explicit explanation in the same review as the
change. This site's policy is documented in
[docs/evaluation.md](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/evaluation.md):
fix the behaviour or justify the threshold change; do not lower a value only to
make a run pass.

## Merge and release gates

The merge gate runs deterministic fixtures with a fake model adapter on every
pull request. It checks changes made in the repository without requiring a
secret or a non-deterministic provider call.

The live gate calls the configured production model and uses an LLM judge. It
runs weekly and before an agent release. This gate can detect model or provider
drift that occurs without a repository change. A schedule limits the time such
drift can remain undetected, but it does not provide continuous detection.

## Limitations

LLM judges inherit model bias and may accept confident but unsupported prose.
Human review and deterministic invariants remain necessary. The current
adversarial score also tests a bounded set of known attacks; it is evidence
about those cases, not a general proof of safety.

Fixtures are snapshots of the current corpus and capability set. When a new
feature changes what the system should retrieve, answer, or refuse, the same
change should add representative evaluation cases.

## Practical starting point

Create a table with one row for each dimension and columns for the measurement,
fixture source, execution mode, threshold, and known limitation. Unfilled cells
identify work that is not yet covered. This produces a reviewable evaluation
plan before any aggregate score is introduced.
