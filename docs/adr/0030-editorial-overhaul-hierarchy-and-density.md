# ADR-0030: Editorial overhaul — one left edge, a verdigris palette, evidence on the page

**Status:** Accepted (2026-10-28)

## Context

The 2026-10-28 design review measured the live site against spec §7
("clear hierarchy", "deliberate whitespace", "visibly authored rather than
template-derived") and §1's 30-second recruiter test, from screenshots at
1440px and 390px in both schemes. The token vocabulary
(ADR-0013/0020/0021/0028) held up; the failures were in information
architecture, layout, density, and distinctiveness:

- **Two left edges on desktop.** The hero and prose sit in the 65ch reading
  column while the project grid takes the 68rem wide canvas, so the left
  edge jumps between ~200px and ~95px at 1440px. ADR-0028 intended the hero
  on the wide canvas; it shipped in the reading column.
- **Cards carry case-study prose.** Each card renders `problem`, `built` and
  `differentiator` — three to four paragraphs — so heights differ ~2× and
  the metric strip sits below the fold of the card.
- **The hero enumerates technologies** rather than stating a position, and
  Technical focus repeats the list two screens later.
- **Contact appears three times** and the closing "This site is a project
  too…" paragraph restates the nav.
- **Employment history is absent from the homepage.**
- **Every section looks the same** (serif h2, rule, body); case studies run
  twelve identically weighted sections with no summary or contents.
- **The palette reads generic.** Warm cream paper, serif display and a
  terracotta accent is one of the most common "tasteful" portfolio looks —
  at odds with "visibly authored".

The site owner reviewed a mockup of the proposal (2026-10-28) with three
palettes and each distinctive touch switchable, and chose the verdigris
palette with every touch on.

The measure-first record spec §18 requires:

- **Baseline:** Lighthouse 100/100/100/100 on static pages, `/ask` ≥ 93
  performance (ADR-0010 budgets); both-scheme axe clean; one font preload;
  mobile layout pinned at 390px by `layout.spec`.
- **Validation:** both-scheme axe over every page; pinned computed colours
  in `a11y.spec` and the palette mirror test updated to the new values;
  `layout.spec` pins one shared left edge at 1440px and no horizontal
  overflow at 390px; `make eval-agent` green after the citation-target move;
  `make check-perf` holding the ADR-0010 budgets.
- **Operational cost:** CSS, templates and one build-time script; one
  additional ~20KB font (decision 6). No client JavaScript beyond what
  exists, no Worker change.

## Decision

Structure, spacing and type scale are **evolved, not replaced**; the
palette is replaced.

1. **One left edge: a rail layout on the wide canvas.** At ≥ 64rem (the
   existing single breakpoint) homepage sections become a two-column grid
   on the wide canvas: a `--rail` column (13rem) carrying the section label
   and any sources, and a body column held to `--measure`. Hero, section
   bodies and footer start on the wide canvas's left line. Below 64rem the
   rail stacks above the body.

2. **Homepage reorder and trim.** Hero → Selected work → Experience →
   How I work → Writing → footer.
   - **Hero:** a rail eyebrow (role · London), name, one positioning
     sentence, one intro paragraph, and actions — _Read the case studies_
     (primary), _Ask about Ed's work_ (secondary), the email address.
   - **Experience:** employer, sector, role and years from the published
     `experience` facts (ADR-0019), linking to `/experience`. No new facts.
   - **Removed:** the Contact section, the closing "deeper" paragraph, the
     separate ask callout, and Technical focus (moves to `/experience`).
   - **Availability stays off the homepage** (Ed's direction); it remains
     on `/experience` per ADR-0022.

3. **Projects as an index, not cards.** Each project is a ruled row: title
   and `problem` in the body, and a side column with one evidence line, tech
   and links. `built` and `differentiator` move to a case-study summary
   panel (decision 9), so every field still renders publicly. The evidence
   line reads the first `metrics` entry; projects without measurements get a
   metric whose value is already published in their own frontmatter (e.g.
   "14 agents · 18 skills" from claude-code-config's `built`) — the schema's
   existing content-boundary rule.

4. **Verdigris palette** — supersedes ADR-0028 decision 4's terracotta. A
   cool, faintly green paper with a deep verdigris accent, in both schemes:

   | Token         | Light     | Dark      |
   | ------------- | --------- | --------- |
   | paper         | `#f5f6f4` | `#131615` |
   | ink           | `#161a19` | `#e6eae8` |
   | muted         | `#545c5a` | `#9aa39f` |
   | accent        | `#1f6b5c` | `#6fbfa9` |
   | rule          | `#e1e4e1` | `#2a2f2d` |
   | rule-strong   | `#d2d7d3` | `#353b39` |
   | paper-raised  | `#ffffff` | `#212625` |
   | accent-subtle | `#e4eeea` | `#1a2b27` |
   | code-string   | `#a84a1f` | `#e89a6b` |

   Every text pair holds ≥ 4.5:1 (lowest: accent on accent-subtle, 5.34
   light). Error stays crimson, now well separated from a green accent.
   Strings in code blocks take the retired terracotta, so syntax keeps two
   distinct hues beside the green keyword accent. Favicon, icons and OG
   cards regenerate from the palette mirror as before.

5. **To-scale evidence.** Where a project's evidence is a before → after
   measurement, a pair of thin bars is drawn to one scale beneath the
   figure (after = after ÷ before of the track). Static HTML with an
   `aria-label` stating both values; decoration only where the numbers
   already appear in text.

6. **A mono face for data** — amends ADR-0021's "one webfont". IBM Plex Mono
   400/500 (OFL, latin subset) via the same fontsource provider, routed
   through `--font-mono`; it sets rail labels, dates, figures, tech tags,
   sources and code. Not preloaded — the 600 serif stays the only preload,
   and the fallback stack is the previous system mono.

7. **Cited claims.** Positioning claims on the homepage carry numbered
   citations, written as standard GFM footnotes in the profile Markdown and
   rendered as a sources list in the section rail (inline after the body
   below 64rem). CSS only: a marker is an in-page link and following it
   highlights the source with `:target`, so the homepage stays at zero
   JavaScript. A Sätteri hast plugin (`src/lib/scoped-footnotes.ts`) scopes
   footnote ids per source file — entries sharing a page would otherwise
   collide — turns the hidden "Footnotes" `h2` into a visible "Sources"
   label so section heading order holds, and drops the "↩" backrefs, which
   fail WCAG 2.2's 24px target size and add little beside the claim. The
   corpus strips footnotes, so cited prose yields byte-identical chunk
   text. `check-content-policy` gains `citation-source`: every footnote
   links to this site or a public `edjchapman` repository.

8. **A build stamp.** One footer line generated at build time from real
   state: build date, short commit SHA, the last deterministic agent-eval
   result, and the Lighthouse budget status from CI. A value that is
   unavailable at build time is omitted, never defaulted — the spec bans
   fake snippets.

9. **Case-study summary and contents.** A summary panel at the top of
   `/projects/[slug]` (what was built, what's different, evidence, stack,
   links), and at ≥ 64rem a static sticky contents list from the entry's
   `h2` headings in the rail. No JavaScript.

10. **Technical focus moves to `/experience`.** `PROFILE_PAGES` gains
    `"technical-focus": "/experience"` so citations resolve where the text
    renders (the ADR-0022 rule). Chunk ids are unchanged;
    `make eval-agent` must stay green with no threshold change.

11. **Primary nav: Projects, Notes, Experience, Ask.** Now and Colophon move
    to the footer with Privacy, Source and RSS.

12. **Copy rewrite under ADR-0011.** The positioning tagline, intro and How
    I work are rewritten shorter, foregrounding correctness under failure
    and platform ownership as part of backend work. Every claim traces to
    published content; Ed approves the wording in PR review.

## Delivery

Focused PRs, each passing `make check` and `make test-e2e`:

1. This ADR + visual system: palette, mono face, nav and footer (4, 6, 11).
2. Homepage: rail layout, reorder, project index, to-scale bars, Technical
   focus move (1, 2, 3, 5, 10).
3. Cited claims and the policy rule (7).
4. Build stamp (8).
5. Case studies (9).
6. Copy (12), held as a draft until Ed approves the wording.

## Alternatives considered

- **Keep the warm palette.** Rejected after side-by-side review: it is the
  most recognisable part of the template look §7 rules out.
- **Ink-blue on white.** Clean, but ADR-0028 recorded Ed rejecting a blue
  accent as reading "finance".
- **Equal-height cards with truncated text.** Rejected: truncation hides
  content mid-sentence; moving the long fields to the case study keeps them
  whole.
- **Citations as a bespoke frontmatter structure.** Rejected for GFM
  footnotes: standard Markdown, already rendered by Astro, readable in the
  raw file.
- **A client-side scroll-spy on the contents list.** Rejected under
  ADR-0004 — a static sticky list carries the value without an island.

## Consequences

- The homepage gets shorter and leads with evidence; depth moves one click
  deeper, to pages built for it.
- Two webfonts instead of one; still one preload.
- Every visible claim now shows where it can be checked, and the build
  stamp makes the site's own quality gates visible — the method the
  positioning describes, made legible on the page.
- ADR-0028's grid stays; this ADR adds the rail inside it, corrects the
  hero to the wide canvas it intended, and supersedes its accent colour.
  ADR-0004, 0013 and 0020 are unaffected.
