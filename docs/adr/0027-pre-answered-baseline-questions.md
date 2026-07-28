# ADR-0027: Pre-answered baseline questions served without a model call

**Status:** Accepted (2026-07-28)

## Context

Common questions — the six example chips, "What is Foreman?", "How do I
contact Ed?" — have stable, already-published answers, yet every one hits the
Anthropic API. That costs money and latency on repeat traffic, and on
2026-07-25 it cost availability: a LinkedIn spike drained the API credit
(ADR-0024) and the whole `/ask` feature went dark, example chips included.

The ask was for "a corpus, something like LangGraph, so we don't have to hit
the LLM every time." LangGraph is the wrong shape here: spec §3 ("simplicity
before infrastructure") bars an orchestration framework, "LangChain or an
equivalent abstraction", and any new storage (KV/D1/Durable Objects) without a
recorded requirement, and §19 lists multi-agent orchestration as a non-goal.
The need is fully met by the pattern this repo already trusts (ADR-0005): a
build-time baked artifact of reviewed answers, compiled into the Worker bundle,
matched deterministically.

The load-bearing tension is with ADR-0018 (fail closed): its whole point is
that a broken model path must be a _visible_ failure, and the monitors define
health as "HTTP 200 + non-empty `sources`" probed with a chip question. If a
baseline answer satisfied that, a dead model would show green — the exact
blindness ADR-0018 exists to prevent.

## Decision

Serve exact-match questions from a build-time artifact, before the model, with
the model path kept independently observable.

- **A separate artifact, not new corpus chunks.** `src/content/ask-baseline/`
  holds one reviewed answer per file (a short paragraph with `[[sectionId]]`
  citation markers). `scripts/build-baseline-answers.ts` strips the markers
  into answer text plus per-claim spans, resolves the sections to canonical
  sources against the freshly-built corpus, and emits
  `src/generated/baseline.json`. Kept out of the retrieval corpus deliberately:
  the corpus feeds a BM25 index whose IDF shifts with every chunk, so adding
  entries there would re-open the documented entity-threshold retune loop
  (ADR-0022). Exact-key lookup has zero effect on retrieval; ADR-0005/0006 are
  untouched.

- **Exact match after normalisation; no fuzzy matching.** `normalizeBaselineKey`
  applies whitespace-collapse, case-fold, curly→straight apostrophe, and
  trailing-punctuation strip over the question and curated aliases. Serving a
  _wrong_ canned answer is worse than a model call, so anything beyond that is
  a reviewed alias, never a guess.

- **Served before the quota gate, after the IP limiter.** A hit costs nothing,
  so it does not spend the visitor's 10/day budget (the example chips work even
  for a quota-exhausted visitor, and right through a credit outage). No
  `Set-Cookie` on a baseline response.

- **`served: "model" | "baseline"` on the success envelope, and the monitors
  assert `served == "model"`** with a nonce-suffixed question that misses the
  baseline. This is the ADR-0018 reconciliation: a baseline answer is reviewed
  published content, visibly labelled, and it can never mask a dead model
  because the monitors probe the model path explicitly. A second probe asserts
  a verbatim chip returns `served == "baseline"`, so the degraded mode is
  monitored too.

- **The lookup lives in the route, not `AgentService`.** The eval runner
  constructs `AgentService` directly (`scripts/run-agent-evals.ts`), so route
  placement leaves the live evals, service tests, and the whole evaluated
  pipeline exercising the model path unchanged — the baseline sits outside the
  eval's jurisdiction.

- **The UI is honest.** A baseline hit renders through the island's existing
  buffered-JSON path (zero parsing changes); the only client change is a
  distinct disclosure — "A pre-written answer from published site content —
  prepared and reviewed in advance, and it isn't Ed speaking." (spec §10: never
  imply Ed is speaking).

- **Content boundary.** Each answer is reviewed content written for this site
  (content-policy category 5), authored from the golden fixtures' vetted
  `requiredClaims`, citing their `expectedSourceIds`. The build **fails** if a
  cited section no longer exists (the staleness tripwire, resolved against the
  same-build corpus), if two entries share a normalised key, if an answer is
  empty or uncited, if a span is out of range, or if the content-policy scan
  flags the text. Career, education, and availability entries carry Ed's
  affirmation in PR review (ADR-0019/0022).

## Alternatives considered

- **New corpus chunks.** Rejected: re-opens the ADR-0022 entity-bar retune loop,
  and still flows through retrieval → model, saving nothing.
- **Edge/HTTP caching.** Rejected: `/api/ask` is POST, `no-store`, and
  cookie-bearing — uncacheable by design (ADR-0009/0024), and it wouldn't skip
  the model anyway.
- **Fuzzy or semantic matching.** Rejected for v1: false positives serve a
  wrong answer with confidence, and semantic matching trips ADR-0006's
  evidence bar. Revisit if `ask.accepted` logs show a volume of near-miss
  phrasings a curated alias can't cover.
- **Lookup inside `AgentService` behind an opt-out.** Rejected: would need
  every eval and service test to opt out; route placement keeps `AgentService`
  pure of the concern.
- **LLM-first, baseline only on failure.** Rejected as the default (it saves no
  cost/latency in normal operation and the mid-stream fallback mechanics are
  ugly — a failure after the SSE 200-commit can't cleanly splice a canned
  answer). The serving-policy switch is a single route call site, so this
  remains a one-place change if the trade-off is ever revisited.

## Consequences

- Example chips answer instantly, free, and through an outage — the direct
  remedy for the 2026-07-25 failure mode.
- The monitors stay honest: they go (and stay) red on a model outage even
  while baseline serving keeps the chips working, because they assert
  `served == "model"`.
- A new build artifact and build step; the baseline resolves against the
  corpus in-process, so the two versions can never skew.
- Answers can drift semantically without the section being renamed (facts
  change, heading survives) — not mechanically detectable; mitigated by the
  content-policy review rule, the builder printing cited sections, and a future
  regenerate-via-pipeline script (not this PR — the credit was exhausted, so
  the initial entries are hand-authored).
- Adding an additive `served` field breaks no existing client (the schema
  makes it optional; a response without it keeps model semantics).

## Relations

Extends **ADR-0018** (fail-closed): a baseline answer is not the "plausible
fake" that ADR forbids — it is reviewed content, labelled `served: "baseline"`,
and the monitors assert the model path, so a missing credential stays visible.
Sibling of **ADR-0005** (build-time artifact pattern); **ADR-0006** intact
(exact-key lookup is not retrieval). Amends **ADR-0023** (a baseline hit logs
`ask.accepted` with the question for abuse-monitoring parity, plus a
content-free `ask.baseline_served`) and **ADR-0024** (hits are answered before
the quota gate and are uncounted).

## Revisit conditions

- `ask.accepted` logs show a volume of near-miss phrasings exact-match can't
  cover → consider fuzzy/semantic matching against ADR-0006's evidence bar.
- The entry count grows past ~50, or the answers need to compose retrieved
  passages → reassess the hand-authored + build-artifact shape.
- Demo authenticity is judged to require the chips visibly streaming from the
  live model → flip the serving policy at the single route call site.
