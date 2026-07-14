# ADR-0011: CV-derived positioning content via reviewed assistant drafting

**Status:** Accepted (2026-07-14)

## Context

The homepage tagline over-indexes on TypeScript/React relative to Ed's
backend and platform depth, and correcting the balance needs context that
lives in the private `career-portfolio` repository. The content policy
already allows private material to _inform drafting_ and already accepts
"positioning material explicitly approved by Ed" (category 4), but spec §3
and the original policy wording confined that drafting to happen outside
this repository and outside assistant prompts — which blocks the working
mode actually in use (AI-assisted drafting in a local session).

## Decision

An assistant session working for Ed may read private career documents
**locally, at Ed's explicit direction**, to draft public-safe positioning
copy, under all of these constraints:

- Raw excerpts are never copied wholesale; drafts are new public-facing
  prose.
- Every CV-derived claim is listed in the PR description and **explicitly
  approved by Ed before merge** — it enters the site as category-4 approved
  positioning material.
- The prohibited-information list is unchanged and still absolute (salary,
  pipeline, contacts, precise location, unverifiable metrics).
- Nothing from private sources appears in commit messages, fixtures, tests,
  logs, or the agent corpus; the mechanical scanner still fails any
  `career-portfolio` reference in shipped surfaces.

The spec §19 non-goal ("migrating private career-portfolio content into the
public repository") stands: this is per-claim reviewed drafting, not
migration.

## Consequences

- Private material read into a local assistant session persists in local
  transcripts — a machine-hygiene exposure of the same class the threat
  model already records for `~/.secrets` (residual risk accepted; the
  2026-07-13 token rotation shows the response path if it bites).
- The review burden moves to PR review: Ed's approval of listed claims is
  now the load-bearing control, matching how positioning content was
  approved on 2026-07-10.
- Spec §3's "never included in prompts" is superseded for this workflow;
  the spec is annotated rather than rewritten (it is committed verbatim).
