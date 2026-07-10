# ADR-0008: Deterministic CI evaluation, live evaluation on demand

**Status:** Accepted (2026-07-10) — implementation lands in Phases 3–4

## Context

The agent is complete only when grounding, refusal behaviour, and answer
quality are covered by repeatable evaluations (spec §12). But model calls are
paid, rate-limited, and non-deterministic — putting them in every PR's
required checks would make merges flaky and couple CI to a production secret.

## Decision

Two evaluation modes with different jobs:

- **Deterministic mode (`make eval-agent`)** — runs inside `make check` on
  every PR. Uses the versioned fixture sets (`tests/agent/*.json`) and a fake
  model adapter. Covers corpus construction, draft exclusion, retrieval
  ranking against golden cases, refusal routing, prompt construction, API
  contract (validation, error mapping, rate-limit behaviour), citation
  whitelisting, and security invariants. No secrets, no network. Blocks
  merging.
- **Live mode (`make eval-agent-live`)** — calls the configured model
  (`ANTHROPIC_MODEL`) through the same adapter interface, judging golden and
  adversarial sets for groundedness, completeness, citation correctness, and
  refusal quality against thresholds documented in
  [docs/evaluation.md](../evaluation.md). Runs manually and on a schedule
  from a protected workflow with a per-run budget cap — never in ordinary PR
  CI. Gates agent releases, not merges.

The release gate for linking `/ask` from the homepage requires both modes
passing plus the manual red-team checklist (spec §12).

## Alternatives considered

- **Live evals on every PR** — flaky, slow, costly; leaks a production
  secret into every fork's CI surface. Rejected.
- **Deterministic only** — a fake adapter cannot measure whether the real
  model, prompted with real passages, stays grounded. Rejected as sufficient.
- **Recorded/VCR provider responses in CI** — recordings rot silently as
  prompts evolve; the fake adapter plus explicit live runs makes staleness
  visible instead. Rejected as the primary mechanism.

## Consequences

- PR CI stays fast, free, and deterministic; a red eval is a real regression.
- Live quality drift is caught on the schedule, not by users.
- Thresholds are set from the first live baseline and then frozen; weakening
  one requires a documented change to docs/evaluation.md (see CLAUDE.md:
  never weaken an evaluation to make CI pass).

## Revisit conditions

- Eval volume or model pricing changes the cost calculus of scheduled runs.
- Provider-side eval tooling matures enough to replace the bespoke harness.
