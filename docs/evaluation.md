# Evaluation

<!-- Stub — expanded in Phases 3–4. -->

Agent evaluation is split into a deterministic CI mode (fixtures + fake model
adapter; blocks merging) and a live mode (`make eval-agent-live`) that calls
the configured model on a controlled schedule with documented thresholds.
`make eval-agent` is a reserved target defined in Phase 3.
