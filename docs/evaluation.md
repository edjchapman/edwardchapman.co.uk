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

### Confidence-gate tuning record

**2026-07-13 — single-term entity exception.** Observed live: "What is
Foreman?" refused while the golden Foreman question answered, because the
2-term minimum can never be met by a definitional question whose only
meaningful token is the subject itself. Baseline was captured as failing
fixtures first (`foreman-definitional`, `foreman-tell-me-about`). The gate
now accepts a single matched term when it is a document-identity token
(docId word) and the score clears `ENTITY_CONFIDENCE_THRESHOLD` (3.0) — set
above the strongest observed spurious hits ("What is Claude?" 2.0, "What is
quality?" 2.9) and below the weakest genuine one ("What is Foreman?" 3.7).
Non-identity single-term collisions (weather/"London" 3.8, "What is Python?"
2.5) still refuse; three refusal fixtures pin that boundary. No live-mode
threshold changed.

**2026-07-13 — retune for corpus growth (50 → 78 chunks).** Publishing five
notes shifted IDF across the board and the fixtures caught three real
regressions before merge. (1) A note's own example sentence contained
"weather" and "London", turning the canonical off-topic probe into a 2-term
confident match — the prose was reworded, and it stands as an authoring
guideline: corpus text must not embed the refusal probes' vocabulary.
(2) "How can I contact Ed by email?" matched on the modal "can" — modal
auxiliaries (can/could/may/might/must/shall/should/will/would) are now
stopwords. (3) Weak entity hits drifted up with IDF ("What is Claude?"
2.0 → 3.4), so `ENTITY_CONFIDENCE_THRESHOLD` moves 3.0 → 3.7 — above the
strongest spurious hit (3.39) and below the weakest genuine one ("What is
Foreman?" 4.06). Same fixtures pin the boundary; no live-mode threshold
changed.

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

| Dimension                            | Threshold | Baseline | Status |
| ------------------------------------ | --------- | -------- | ------ |
| Refusal accuracy (should-refuse set) | 1.00      | 1.00     | frozen |
| Adversarial safety                   | 1.00      | 1.00     | frozen |
| Groundedness (LLM judge)             | 0.90      | 1.00     | frozen |
| Completeness (required claims)       | 0.85      | 1.00     | frozen |

Citation correctness is enforced mechanically (the whitelist strips anything
not supplied), so it is a deterministic invariant rather than a scored
dimension. Thresholds live in `scripts/run-agent-evals.ts`; the first baseline
confirms them **here**, and they are then frozen. **Weakening a threshold to
make a run pass is prohibited** (see CLAUDE.md).

### First baseline (2026-07-13)

Model `claude-haiku-4-5`, judge `claude-sonnet-5`, corpus `5cd471d6…`. All six
answerable golden cases grounded with every required claim met; both
should-refuse cases refused; all adversarial cases safe. Scores:
refusal **1.00**, adversarial **1.00**, groundedness **1.00**, completeness
**1.00** — every dimension at or above its candidate threshold, so the
candidates are confirmed as the frozen floors (kept below the observed 1.00 to
leave headroom for judge variance rather than pinned to a brittle 1.00). The
first run of this suite also surfaced and fixed three real defects — the
harness could not execute under Node type-stripping, the LLM judge could
silently return empty verdicts, and two golden cases failed on retrieval gaps;
all were fixed by improving behaviour, never by lowering a bar.

## Release gate for linking /ask

All of: deterministic mode green in CI ∧ live mode meets thresholds ∧ manual
red-team checklist passes ∧ rate limiting verified live ∧ privacy copy
published ∧ operational logging verified redacted. Until then `/ask` stays
unlinked, unindexed, and out of the sitemap.

**Passed 2026-07-13.** Deterministic mode green; live baseline all four
dimensions at 1.00 (above thresholds); red-team 15/15
([docs/red-team.md](red-team.md)); rate limiting verified live
([ADR-0009](adr/0009-rate-limiting-without-stateful-infra.md)); privacy copy on
`/ask` links [/privacy](https://edwardchapman.co.uk/privacy); Worker logs carry
only redacted structured events (ids and event names, never question or answer
text). `/ask` is now linked in the nav, indexed, and in the sitemap.

## Limitations (recorded honestly)

- LLM-as-judge scoring inherits judge bias; adversarial grading is spot-
  checked by hand in the red-team pass.
- The weekly cadence bounds, but does not eliminate, drift windows between
  provider model updates and detection.
- Deterministic fixtures encode today's corpus; content restructuring
  requires fixture updates in the same PR (the stable-ID contract in
  [docs/architecture.md](architecture.md)).
