# ADR-0019: Published career history, sourced from the public LinkedIn profile

**Status:** Accepted (2026-07-21)

## Context

The ask agent refuses the questions its primary audience asks most. Recruiters
and hiring managers (spec §1) ask where Ed has worked, for how long, with which
technologies, and what he studied — and the corpus contains none of it, so the
confidence gate refuses before the model is called. That is the boundary
working as designed: ADR-0007 scopes the corpus to published content, and
ADR-0011 forbids publishing any fact whose only support is private material,
so the site could not simply absorb CV facts from the private
`career-portfolio` repository.

What changed is the sourcing option. Ed's public LinkedIn profile
(`linkedin.com/in/edjchapman`) publicly documents his employment history and
education, and the site already publishes that link as part of Ed's identity
(`src/lib/site.ts`, JSON-LD `sameAs`). A public, Ed-controlled record of the
missing facts exists; the content policy just never listed it as an approved
source.

## Decision

1. **The content policy gains approved source category 6: Ed's public
   LinkedIn profile** — employment history (employers, titles, date ranges),
   education, and public-safe role facts. Drafting may prepare content from
   Ed's canonical records under the ADR-0011 workflow; **Ed's PR review
   affirms that each published fact appears on the public profile**, and that
   affirmation is the verification mechanism (stated in the PR description
   per the content-policy review requirements).
2. **A new `/experience` page renders new `profile` entries** (the colophon
   pattern: profile entries rendered on their own page) covering work history,
   education, strengths and leadership, and per-technology depth. Per-tech
   depth is expressed as **since-dates derived from the published role date
   ranges** ("daily across all roles since 2017"), never as bare year-counts
   with no derivation. A since-date that cannot be derived from published
   dates is dropped, not estimated.
3. **The prohibited-information list is unchanged and gains explicit
   entries** for the newly adjacent risks: reasons for leaving a role, and
   team headcounts or coworker names. Salary, pipeline, precise location, and
   employer-internal details remain absolute exclusions — and become
   adversarial evaluation cases, because publishing employer names lets
   employer-phrased probes pass the retrieval gate for the first time.
4. **The homepage is untouched** (spec §6: it must not read like a pasted
   CV). The corpus boundary is unchanged: the new entries are ordinary
   `profile` entries with `corpus: true`, exactly the set ADR-0007 already
   ingests.

## Alternatives rejected

- **Career sections on the homepage.** Spec §6 explicitly forbids a
  pasted-CV homepage; a dedicated page keeps the 30-second scan intact.
- **A downloadable CV.** Remains a spec §19 non-goal; a rendered page is
  citable by the agent and diffable in review, a download is neither.
- **Keep refusing.** Refusing the primary audience's core questions defeats
  the agent's product objective; the refusal boundary should mark what is
  private, not what was merely unwritten.
- **Migrating career-portfolio content.** Remains a spec §19 non-goal and an
  ADR-0011 prohibition. LinkedIn is the source; the private repo still only
  informs emphasis, ordering, and phrasing.

## Consequences

- The corpus grows (~80 → ~95 chunks) and IDF shifts; retrieval fixtures and
  the confidence gate follow the documented tuning discipline in
  docs/evaluation.md (fixtures first; wording, then synonyms, then a recorded
  threshold retune as last resort).
- Employer-named questions now clear the retrieval gate, so refusing
  salary/pipeline/leaving/coworker probes phrased with employer names becomes
  the model layer's job (system-policy rules), verified by new adversarial
  fixtures at the frozen 1.00 thresholds and a red-team re-run (cases 3, 4,
  and 12 re-phrased with employer names).
- `profile` entries have no draft flag: the PR that lands the content
  publishes the page and feeds the agent in the same deploy. Ed's PR approval
  is the go-live decision.
- If the LinkedIn profile and the site drift, the per-fact affirmation in PR
  review is the sync point; corrections follow the content-policy
  removal/correction procedure.

## Revisit conditions

- Live evals or red-team runs show employer-named probes leaking prohibited
  information — tighten the system policy or add retrieval-side handling.
- The site later needs facts LinkedIn does not carry — extend the source
  categories explicitly rather than stretching category 6.
