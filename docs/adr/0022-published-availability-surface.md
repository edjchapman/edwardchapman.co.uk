# ADR-0022: A published availability surface, corpus-included and Ed-affirmed

**Status:** Accepted (2026-07-24)

## Context

The most common recruiter question — availability: openness to contract vs
permanent work, remote/hybrid stance, relocation — was unanswerable. The
2026-07-24 design review measured every phrasing refusing at the retrieval
gate. Unlike salary or leaving reasons this is not policy-prohibited
(docs/content-policy.md's prohibited list does not include it); it was
simply unpublished, so the agent correctly refused.

Two prior decisions shape the solution. `/now` is deliberately
`corpus: false` (its own frontmatter records why: it changes often, and
every corpus change re-opens the retrieval tuning loop) — so the "current
status" page cannot carry this. And ADR-0019 established the pattern for
publishing personal facts: a stable profile entry whose facts Ed affirms
in PR review.

## Decision

1. **A new stable profile entry, `availability.md`** (`corpus: true`,
   heading-less → one `availability#body` chunk), rendered on
   `/experience` under a page-supplied heading so the chunk id stays
   stable and citations resolve where the text renders. Stance-level facts
   only — the kind that change rarely; week-to-week status stays on
   `/now`, which remains corpus-excluded.
2. **The facts are Ed's own declarations**, written for this site —
   approved source categories 4/5 already cover them, so
   docs/content-policy.md needs no new source category (unlike ADR-0019's
   LinkedIn sourcing). The entry was drafted with explicit
   `[PENDING ED'S FACTS]` placeholders and the PR held as a draft until
   Ed supplied each stance directly (2026-07-24); **his PR approval is
   the go-live decision** (profile entries have no draft flag by
   design).
3. **The adjacency boundary is explicit**: notice period, visa /
   right-to-work, interview pipeline, and salary remain unpublished and
   gate-refused — pinned by the existing `notice-period`, `visa-status`,
   and `salary` refusal fixtures, which this change re-verifies. The
   entry's authoring rule: its body must never contain those probes'
   vocabulary.
4. **Query-side bridges** map recruiter phrasings onto the entry's own
   tokens (available/contract/contracting/freelance/permanent/perm/remote/
   remotely/hybrid/relocate/relocating/relocation/hire/hiring/opportunity/
   looking → anchored on "availability"). Deliberately not bridged:
   "notice", "visa", and "open" (which would pollute open-source queries)
   — and, as ever, employer names.

## Consequences

- Five new retrieval cases and one new golden (claims pending Ed's facts)
  pin the surface; the example-chip set gains the golden's verbatim
  question. The first live run after merge is the golden's first scoring —
  to be recorded in docs/evaluation.md.
- Corpus growth (101 → 102 chunks) consumed the entity gate's 0.002
  margin, forcing the documented retune (4.2 → 4.35) — recorded in
  docs/evaluation.md, including the closure of the "What is quality?"
  open observation the new spacing made possible.
- A recruiter's first qualifying question now gets a grounded, cited
  answer instead of a refusal — without weakening any prohibited-topic
  boundary.
