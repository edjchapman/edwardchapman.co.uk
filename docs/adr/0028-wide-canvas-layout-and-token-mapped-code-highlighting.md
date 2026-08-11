# ADR-0028: Wide-canvas responsive layout and token-mapped code highlighting

**Status:** Accepted (2026-08-12)

## Context

The 2026-08-11 design review measured the site against spec §7 ("clear
hierarchy", "deliberate whitespace", "excellent mobile experience", visibly
authored rather than template-derived) and found the visual system complete
in vocabulary but under-executed in two places:

- **No responsive layout system.** Zero breakpoints existed anywhere; every
  page was a single ~65ch column at every viewport. Mobile was excellent by
  construction, but desktop — the screen most reviewers use — left two
  thirds of the canvas empty, and structural elements (project cards, index
  lists, the hero) were compressed to prose width for no editorial reason.
- **Code blocks ignored the palette.** Markdown fences rendered Shiki's
  default `github-dark` theme: a hardcoded `#24292e` background clashing
  with the warm light paper and static across colour schemes, in a token
  system whose stated contract is "components consume these custom
  properties only".

The measure-first record spec §18 requires:

- **Observed problem:** as above, from the review's code audit and live
  screenshots (1440px/390px, both schemes).
- **Baseline:** one column everywhere; `github-dark` fences; Lighthouse
  100/100/100/100 on all static pages, `/ask` ≥ 93 performance.
- **Validation:** axe (WCAG 2.2 AA) in both schemes including a page with a
  code fence; a layout spec pinning the desktop grid and the absence of
  horizontal overflow; the existing mobile nav/overflow pins at 390px;
  `make check-perf` holding the ADR-0010 budgets.
- **Operational cost:** ~zero — CSS only; no dependencies, no new JS, no
  Worker or build changes.

## Decision

1. **A breakout grid on `main`, one wide track, one breakpoint.** Every
   page's `main` becomes a named-line CSS grid: children land in the
   reading column (`--measure`, 65ch) by default; structural elements opt
   into the wide canvas (`--measure-wide`, 68rem) with a `.u-wide` class.
   The wide side-tracks are `minmax(0, (wide − measure) / 2)`, so they
   collapse to zero on narrow viewports and the sub-600px rendering is
   unchanged. Prose never leaves the measure. `.u-wide` and `.card-grid`
   are the small utility layer spec §2 explicitly allows once "repeated
   styling patterns clearly justify it".

   The single desktop breakpoint is **64rem**, used only where columns
   change (card grid, notes marginalia). Media queries cannot read custom
   properties, so the literal is the convention — documented in
   `tokens.css`, discoverable by grepping "64rem".

2. **New scale tokens, same ratios.** `--text-4xl` extends the 1.25 modular
   scale one step for the hero; `--space-7` (6rem) extends the spacing
   scale for desktop air; `--measure-wide` (68rem) sizes the wide canvas so
   three project cards hold a comfortable ~21rem each. No colour token
   changes — the palette mirror (`src/lib/palette.ts`) is untouched.

3. **Syntax highlighting through the token contract.** `shikiConfig.theme`
   is `css-variables`: Shiki emits `var(--astro-code-*)` colours resolved
   by `tokens.css`, which maps them onto the paper/ink palette (ink,
   muted, accent) plus one new hue — the string olive (`#5a6427` light /
   `#b3c47c` dark, 6.39:1 / 8.19:1 on `--color-paper-raised`). Highlighting
   stays build-time; dark mode arrives via `prefers-color-scheme` like
   every other colour on the site (ADR-0013).

4. **A warm accent, at Ed's direction.** The blue accent (`#1a5fb4` /
   `#7fb0ef`) read corporate against the warm paper; Ed asked for something
   "less finance". The accent becomes terracotta (`#a84a1f` light, 5.44:1
   on paper) / soft apricot (`#e89a6b` dark, 7.98:1), with the callout tint
   (`--color-accent-subtle`) retuned warm to match (`#f7ede5` / `#33261c`).
   The error hue moves from rust to crimson (`#a12733` / `#f2a3ae`) so
   error and accent — now neighbours in temperature — never read as the
   same signal. All pairs verified ≥ 4.5:1 in both schemes and enforced by
   the both-scheme axe scans; the favicon, icons, and OG cards regenerate
   from the palette mirror at build time. The hero carries a short accent
   bar quoting the favicon/OG mark, aligned with the reading column.

## Alternatives considered

- **Named Shiki themes per scheme (`themes: { light, dark }`).** Rejected:
  every named theme hardcodes hexes that fight the warm palette and sit
  outside the token contract; several popular light themes' comment colours
  fall below 4.5:1 and would fail the both-scheme axe gate. A dual-theme
  build also doubles the inline style payload per token.
- **Per-page wide wrappers instead of a shared grid.** Rejected: every page
  would re-implement the same centering arithmetic, and the reading column
  and wide canvas could drift apart. One grid on `main` makes the two
  widths a single source of truth.
- **A container-query layout.** Rejected as unearned complexity: the design
  has exactly one structural breakpoint, and the canvas is viewport-scoped
  by definition.

## Consequences

- Desktop viewports get a designed layout — hero and card grids on the
  wide canvas, dates hanging in the notes index margin — while mobile
  rendering is byte-identical to the previous single column.
- `main` becoming a grid stops sibling margins collapsing; trailing margins
  are trimmed where they used to collapse away (`.prose > :last-child`).
- Components must keep consuming colour tokens for code the same as for
  everything else; a future syntax colour is a `tokens.css` change, not a
  theme swap.
- ADR-0004 (no new JS), ADR-0013 (no toggle), ADR-0020 (motion/elevation
  vocabulary) and ADR-0021 (one serif, one preload) are all unaffected.
