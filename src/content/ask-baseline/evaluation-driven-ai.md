---
question: "What does Ed mean by evaluation-driven AI engineering?"
aliases:
  - "What is evaluation-driven AI engineering?"
---

By evaluation-driven AI engineering Ed means treating AI quality as something measured, not asserted: LLM output is evaluated against versioned expectations rather than checked with exact string assertions.[[llm-as-judge-as-a-ci-quality-gate#intro]] In the AI Due-Diligence Assistant the evaluation harness gates the build — the agent runs over reference companies and every finding is scored against a golden set by an LLM-as-judge, in CI on every push, so a regression turns CI red.[[ai-due-diligence-assistant#important-engineering-decisions]]
