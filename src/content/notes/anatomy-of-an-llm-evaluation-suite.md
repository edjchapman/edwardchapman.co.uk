---
title: "Anatomy of an LLM evaluation suite"
description: "One score can't tell you why an LLM feature regressed. The suite that can: separated dimensions, thresholds frozen from measured baselines, and a release gate distinct from the merge gate."
pubDate: 2026-07-13
tags:
  - ai-engineering
  - evaluation
draft: true
---

The first evaluation most LLM features get is a single number — "the agent
scores 87%" — and a single number is almost useless. When it drops, you
don't know if retrieval broke, the model started hallucinating, citations
went stale, or the refusal behaviour got timid. An evaluation suite earns
its keep by **separating the dimensions**, so a regression names its own
cause.

I've written before about
[making the score a CI gate](https://edwardchapman.co.uk/notes/llm-as-judge-as-a-ci-quality-gate);
this note is about what to measure. The worked example is this site's own
[ask agent](https://edwardchapman.co.uk/ask), whose full harness —
fixtures, thresholds, reports — is in the
[public repository](https://github.com/edjchapman/edwardchapman.co.uk).

## The dimensions that pull apart

Six questions, each answerable independently:

1. **Retrieval** — given this question, did the right sections surface?
   Pure fixtures, no model involved.
2. **Groundedness** — is every claim in the answer supported by the
   supplied passages? This is the hallucination dimension.
3. **Completeness** — did the answer include the claims it _should_ have?
   Groundedness alone rewards timid answers; completeness is its
   counterweight.
4. **Citation correctness** — do the returned sources correspond to
   passages actually supplied? Enforceable mechanically with a whitelist,
   which makes it an invariant, not a score.
5. **Refusal quality** — do questions the corpus can't answer take the
   refusal path? A suite without should-refuse cases rewards a system that
   answers everything.
6. **Adversarial safety** — injection attempts, role-change requests,
   probes for private data. Scored pass/fail per case, spot-checked by
   hand.

The pairings are the design insight: groundedness without completeness
breeds timidity, completeness without groundedness breeds confabulation,
and neither means anything if retrieval quietly broke upstream.

## Thresholds: measured, then frozen

Where do the passing bars come from? Not from aspiration. Run the suite,
record the baseline, set each threshold at or just below the measured
score, and **freeze it in a document that requires a justified edit to
change**. Two failure modes die with this move: thresholds invented before
evidence (which fail forever and get deleted), and thresholds quietly
lowered to make a red run green — the evaluation equivalent of deleting
the failing test. This site's rule is written down: weakening a bar to
pass is prohibited; fix the behaviour or justify the change in the
evaluation doc.

Leave headroom below perfect scores even when you hit them — an LLM judge
has variance, and a threshold pinned at 1.00 turns judge noise into build
noise.

## Two gates, not one

The merge gate runs deterministically — fixtures, fake model adapter,
keyless, on every pull request. The release gate runs live — real model,
LLM-as-judge scoring, on a schedule and before anything user-visible
changes. The split matters because they hunt different prey: the merge
gate catches _your_ regressions the commit they happen; the live run
catches _drift_ — the provider updated the model and your groundedness
moved without any commit at all. A weekly cadence bounds that detection
window; it doesn't eliminate it.

## Honest limitations

An LLM judge inherits bias and can be generous to fluent nonsense —
true-negative cases bound the effect but don't remove it, so human
spot-checks stay on the checklist. And every fixture set is a snapshot of
the corpus and capabilities you had when you wrote it: each new feature
needs new golden cases in the same change, or the suite decays into a
guard for last quarter's product.

## Where to start

Write the six dimensions as column headers. For your feature, fill in: how
each is measured, what the current score is, and which gate it runs in. The
empty cells are your roadmap — and the moment every cell is full, you have
something rarer than a benchmark: an argument, with evidence, that your
LLM feature works.
