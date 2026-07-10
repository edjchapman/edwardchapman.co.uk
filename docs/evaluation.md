# Evaluation

How the "ask" agent is judged before anyone gets to use it. The governing
decision is [ADR-0008](adr/0008-deterministic-and-live-evaluation-split.md):
deterministic evaluation blocks merges; live evaluation gates releases.

## Why two modes

A paid, non-deterministic model call has no business in required PR checks —
it makes merges flaky and couples CI to a production secret. But a fake
adapter cannot tell you whether the real model, given real passages, stays
grounded. So the suite is split by what each mode can actually prove.

## Deterministic mode — `make eval-agent` (Phase 3)

Runs inside `make check` on every PR. No network, no secrets. Covers, against
versioned fixtures in `tests/agent/`:

- corpus construction (draft exclusion, stable IDs, policy scan of output)
- retrieval ranking (`retrieval-cases.json`: query → expected section IDs)
- refusal routing below the confidence threshold
- prompt construction (snapshot)
- API contract via the fake model adapter: validation, error shapes,
  timeouts, provider-failure mapping, rate-limit behaviour
- citation whitelisting and security invariants
  (`adversarial-questions.json`)

A regression here is a blocked merge, by design.

## Live mode — `make eval-agent-live` (Phase 4)

Calls the configured model (`ANTHROPIC_MODEL`) through the production
adapter. Scores golden and adversarial sets for **groundedness,
completeness, citation correctness, and refusal quality** using an
LLM-as-judge, against thresholds recorded in this document once the first
baseline run exists (set from evidence, then frozen — see below).

Runs from `eval-live.yml`: manual dispatch plus a weekly schedule, inside the
`production` GitHub environment, with a hard per-run question budget.
Reports are workflow artifacts; logs contain scores and case ids — never full
prompts, questions, or secrets.

## Thresholds

| Dimension                         | Threshold               | Status          |
| --------------------------------- | ----------------------- | --------------- |
| Groundedness                      | TBD from first baseline | pending Phase 4 |
| Completeness                      | TBD from first baseline | pending Phase 4 |
| Citation correctness              | TBD from first baseline | pending Phase 4 |
| Refusal quality (adversarial set) | TBD from first baseline | pending Phase 4 |

Rules: thresholds are set from the first live baseline, recorded here with
the run link, and then only change via a PR that explains why. **Weakening a
threshold to make a run pass is prohibited** (see CLAUDE.md).

## Release gate for linking /ask

All of: deterministic mode green in CI ∧ live mode meets thresholds ∧ manual
red-team checklist passes ∧ rate limiting verified live ∧ privacy copy
published ∧ operational logging verified redacted. Until then `/ask` stays
unlinked, unindexed, and out of the sitemap.

## Limitations (recorded honestly)

- LLM-as-judge scoring inherits judge bias; adversarial grading is spot-
  checked by hand in the red-team pass.
- The weekly cadence bounds, but does not eliminate, drift windows between
  provider model updates and detection.
- Deterministic fixtures encode today's corpus; content restructuring
  requires fixture updates in the same PR (the stable-ID contract in
  [docs/architecture.md](architecture.md)).
