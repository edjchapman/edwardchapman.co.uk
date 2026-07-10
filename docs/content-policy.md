# Content policy

What may be published on edwardchapman.co.uk, where it may come from, and how
the policy is enforced. The architectural decision behind this policy is
[ADR-0007](adr/0007-public-content-boundary.md).

## Approved source categories

Content may be drawn from, and only from:

1. The public GitHub profile ([github.com/edjchapman](https://github.com/edjchapman))
   and its profile README.
2. Public repositories under that account — their READMEs, docs, ADRs, and
   code.
3. Public project demos linked from those repositories.
4. Positioning material explicitly approved by Ed for publication (including
   material previously published on public branches of this repository).
5. Content written specifically for this site, in this repository, through
   normal review.

Private material — including the private `career-portfolio` repository,
application notes, recruiter correspondence, and interview information — may
inform *drafting* done outside this repository, but no text, metric, or fact
traceable only to a private source may be committed, built, prompted, or
logged here.

## Prohibited information

Never published, in any form:

- Salary details, compensation history, or expectations.
- Active interview pipeline information or recruiter conversations.
- Private application notes; private email threads.
- Non-public client or employer information; confidential architecture or code.
- Personal phone numbers.
- Home address or precise location (city-level — "London" — is the maximum).
- Downloadable private CV material.
- **Claims or metrics that cannot be supported by a public source.**

The contact email `ed@edwardchapman.co.uk` is the approved public
professional address (approved 2026-07-10). No other email address may
appear; the scanner fails closed on any address not in its allowlist.

## Mechanical enforcement

`scripts/check-content-policy.ts` runs inside `make check` (locally, in PR
CI, and weekly). Rules live in
[`scripts/content-policy-rules.json`](../scripts/content-policy-rules.json):
private-repo references, UK phone numbers, full postcodes, salary figures,
non-allowlisted emails, and (post-cutover) non-canonical origins in built
output. Scanned surfaces: `src/`, `public/`, `docs/` (rule-dependent), and
the built `dist/client/`.

False positives are handled with an inline, greppable marker on the affected
line — `content-policy-allow:<rule-id>` — never by weakening a rule.

## Review requirements

- Every PR affirms the no-private-material checkbox in the PR template.
- New professional claims (positioning copy, case-study metrics) must name
  their public source in the PR description if it isn't obvious from the diff.
- Changes to `content-policy-rules.json` are policy changes: the PR
  description must say what is being allowed/forbidden and why.

## Agent grounding rules (Phase 3+)

The "ask" agent may only answer from the build-time corpus, which contains
exactly: non-draft `projects` and `notes` entries, and `profile` entries with
`corpus: true`. Drafts, pages like `/privacy`, and anything outside the
collections never enter the corpus. The corpus builder re-runs the
prohibited-terms scan over its own output as a final tripwire. Questions the
corpus cannot support are refused, not improvised.

## Removing or correcting published information

1. Edit or delete the content entry (or flip it to `draft: true`) in a PR;
   merging redeploys the site without it. The corpus rebuilds in the same
   deploy, so the agent stops citing it simultaneously.
2. For urgent removals, `wrangler rollback` to a version predating the
   content, then land the removal PR.
3. Git history is public: if something prohibited ever lands, treat it as an
   incident — rewrite history (force push after review), rotate any exposed
   credentials, and record the event in the PR that fixes it. The scanner
   exists to make this path never needed.
