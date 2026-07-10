# ADR-0007: The public-content boundary

**Status:** Accepted (2026-07-10)

## Context

Private career material (a private `career-portfolio` repository, application
notes, recruiter correspondence, salary information) exists and may inform
what gets written for this site — but must never enter the public artefact:
not the repo, not build output, not prompts, not logs (spec §3, §5). A
boundary that relies on authorial care alone will eventually leak; it needs
mechanical enforcement.

## Decision

The boundary is defined by data shape and enforced by the gate:

1. **Published content = non-draft entries in the typed collections**
   (`projects`, `notes`) **plus `profile` entries with `corpus: true`**, plus
   pages authored in `src/pages`. Nothing else is site content.
2. **The Phase-3 agent corpus ingests exactly that published set** — the
   corpus builder reads the collections through the same schemas and excludes
   drafts and `corpus: false` entries. Never widen the corpus to make an
   answer possible.
3. **`scripts/check-content-policy.ts` runs inside `make check`** (locally,
   in CI, weekly): it fails the build on references to the private repo in
   shipped trees, on phone numbers, full postcodes, salary figures, and on
   any email address other than the approved public contact
   (fail-closed allowlist in `scripts/content-policy-rules.json`).
4. **Docs may name prohibited things** (this file does); shipped surfaces
   (`src/`, `public/`, `dist/client/`) may not.

[docs/content-policy.md](../content-policy.md) is the human-readable policy;
this ADR records the architectural decision that policy is enforced by the
same gate as tests and types.

## Alternatives considered

- **Policy by review checklist only** — survives until the first tired
  Friday merge. Rejected as the sole mechanism (it remains in the PR
  template as defence in depth).
- **Private material in a gitignored directory inside this repo** — one
  `git add -f` from disaster; private sources stay outside the repository
  entirely. Rejected.

## Consequences

- A policy violation is a red build, not a retrospective incident.
- The scanner's rules file is versioned, so the policy's evolution is itself
  reviewable history.
- False positives are handled by explicit, greppable inline allow markers
  (`content-policy-allow:<rule-id>`), never by weakening a rule silently.

## Revisit conditions

- New classes of sensitive material appear (add rules, don't reinterpret).
- The site gains user-generated or third-party content (a different threat
  model; would need its own ADR).
