---
title: "LLM-as-judge as a CI quality gate"
description: "How to make an LLM system's answer quality a property CI can enforce: a golden set with true negatives, deterministic providers so the gate runs keyless, and an LLM judge whose own bias is bounded by the fixtures."
pubDate: 2026-07-11
tags:
  - ai-engineering
  - evaluation
  - ci
relatedProject: ai-due-diligence-assistant
---

"The answers look good" is not a property a build system can enforce. If an
LLM sits inside your product, its output quality is behaviour — and behaviour
you don't test regresses silently. The pattern that fixes this is old
discipline in new clothes: score the system against a fixed reference on
every push, and fail the build below threshold. The interesting problems are
in the details, and I hit all of them building the
[AI Due-Diligence Assistant](https://edwardchapman.co.uk/projects/ai-due-diligence-assistant), whose
eval harness runs in CI on every push.

## The shape of the gate

Three pieces:

1. **A golden set** — reference inputs with expected outcomes, authored and
   versioned like any other fixture. For a due-diligence agent: companies
   whose filings should trigger specific flags, with the expected verdict per
   check.
2. **A judge** — something that scores the system's actual output against the
   golden expectation. String equality is too brittle for generated prose;
   an LLM-as-judge grades whether the finding _means_ the right thing and
   cites the right evidence.
3. **A threshold wired into CI** — the score gates the merge. Below
   threshold, the build is red, exactly as if a unit test failed.

## The part everyone gets wrong: true negatives

A golden set of only positive cases teaches you nothing — a system that
flags _everything_ passes it. The AI-DDA golden set was authored with a
clean control company and a deliberately negated going-concern note, so the
scoring has signal: flag-everything scores 66%, and only a system that
correctly _clears_ the clean company reaches 100%. If your eval can't
distinguish "cautious" from "correct", it isn't measuring quality; it's
measuring verbosity.

The general rule: **build the corpus for the eval**, not the eval for
whatever corpus you happen to have.

## The part that makes it CI-able: determinism

A paid, non-deterministic model call has no business in a required check —
it makes merges flaky, couples CI to a production secret, and bills you per
push. The fix is a provider seam: embeddings, reasoning, and the judge each
sit behind a switch, with real providers in production and deterministic
local stand-ins in CI. The deterministic judge catches structural and
retrieval regressions on every push, keyless; the real-model evaluation runs
on a schedule and before releases, where flakiness and cost are acceptable
and drift is the thing you're actually hunting.

That split — deterministic evaluation blocking merges, live evaluation
gating releases — is the same architecture this site uses for its own
"ask" agent (recorded as an ADR in the
[site's repository](https://github.com/edjchapman/edwardchapman.co.uk)).

## What the gate actually catches

In practice, the failures this surfaces are rarely "the model got dumber".
They're system regressions the model was papering over: a retrieval change
that stops surfacing the evidence chunk, a scoping bug that leaks another
company's filings into context, a prompt edit that breaks the citation
format, a golden-set edit that quietly weakened a case. All of those turn CI
red the commit they happen — which is the entire point.

## Honest limitations

An LLM judge inherits judge bias: it can be generous to fluent-but-wrong
answers. True negatives in the golden set bound this but don't eliminate it,
which is why the live evaluation layer exists and why spot-checking judge
decisions by hand stays on the checklist. And a golden set is a snapshot —
it needs to grow with every new capability, or the gate slowly stops
guarding the thing you shipped last quarter.

## Where to start

If you have an LLM feature and no eval: write five golden cases today —
including at least one where the correct answer is "nothing to report" — and
score them with the cheapest judge that can tell right from wrong. Wire it
into CI before you tune anything. You can't improve what you haven't pinned
down, and you can't trust what a red build can't protect.
