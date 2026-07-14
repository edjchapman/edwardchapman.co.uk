# ADR-0011: CV-informed positioning drafting, public-source claims only

**Status:** Accepted (2026-07-14); amended (2026-07-14) — the original
version allowed per-claim publication of private-source-only facts, which
contradicted the content policy's prohibited-claims rule and this ADR's own
corpus constraint. This amendment resolves the conflict by narrowing scope.

## Context

The homepage tagline over-indexed on TypeScript/React relative to Ed's
backend and platform depth, and correcting the balance benefits from context
in the private `career-portfolio` repository. The content policy allows
private material to _inform drafting_, but spec §3 confined that drafting to
happen outside assistant prompts — blocking the working mode actually in use
(AI-assisted drafting in a local session).

The first version of this ADR also tried to allow publishing claims
traceable only to private sources, subject to Ed's per-claim PR approval.
That conflicted with three standing rules: the prohibited-information list
("claims or metrics that cannot be supported by a public source"), the
AGENTS.md/CLAUDE.md hard content boundary, and — because `profile` entries
with `corpus: true` feed the ask agent — this ADR's own requirement that
nothing private enters the agent corpus.

## Decision

An assistant session working for Ed may read private career documents
**locally, at Ed's explicit direction**, to inform positioning copy — but
only for **emphasis, ordering, and phrasing**. The claims boundary is
unchanged:

- Every professional claim in published content must be supported by an
  identifiable public source: public repos, live demos, or positioning
  material already published on this site (category 4/5 of the content
  policy).
- Private context may determine _which_ published facts to foreground; it
  may never introduce a fact that has no public support. A claim whose only
  support is private material is not publishable, regardless of review.
- Corpus-facing content (`projects`, `notes`, `profile` with `corpus: true`)
  therefore never carries private-source-only claims — consistent with
  ADR-0007.
- Raw private text is never copied; nothing private appears in commit
  messages, fixtures, tests, or logs; the prohibited-information list is
  absolute.

## Consequences

- Private material read into a local assistant session persists in local
  transcripts — a machine-hygiene exposure of the same class the threat
  model records for `~/.secrets` (residual risk accepted; the 2026-07-13
  token rotation shows the response path if it bites).
- Publishing a genuinely new professional fact requires making it public
  first (e.g. in a public repo or an Ed-authored site change through normal
  review) — the site cannot be the first and only home of a private fact.
- Spec §3's "never included in prompts" is superseded only for Ed-directed
  drafting sessions; the spec is annotated rather than rewritten.
