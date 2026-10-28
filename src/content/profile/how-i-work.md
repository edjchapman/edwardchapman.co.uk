---
title: "How I work"
order: 2
updatedDate: 2026-10-28
tags:
  - AI-assisted software delivery
  - approach to AI engineering
  - agentic tooling in a harness
  - evaluation-driven development
  - working method and process
---

- **Spec first.** The hard thinking happens in writing before broad
  implementation; this site's commissioning spec and architecture decision
  records are public in its repository.[^adrs]
- **Measured, not asserted.** Evaluation-driven by default: reliability numbers
  come from load tests;[^load-tests] AI quality comes from evaluation harnesses
  in CI, scored against thresholds that gate merges and releases.[^evaluation]
- **Rules run as code.** Content policy, commit standards and quality gates run
  on every change; a violation is a red build, not a retrospective.[^policy]
- **Small, reviewable steps.** Strict conventional commits, squash-merged PRs,
  and one deterministic gate shared by local, CI and scheduled runs.
- **AI in a harness.** Agentic tooling does the mechanical work; architecture,
  judgement and review stay human.

[^adrs]: [This site's decision records](https://github.com/edjchapman/edwardchapman.co.uk/tree/main/docs/adr)

[^load-tests]: [Foreman: measured with Locust load tests](https://edwardchapman.co.uk/projects/foreman)

[^evaluation]: [This site's evaluation thresholds](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/docs/evaluation.md)

[^policy]: [The content-policy check](https://github.com/edjchapman/edwardchapman.co.uk/blob/main/scripts/check-content-policy.ts)
