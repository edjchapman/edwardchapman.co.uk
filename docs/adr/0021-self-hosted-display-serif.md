# ADR-0021: One self-hosted display serif via the fonts API

**Status:** Accepted (2026-07-24)

## Context

The editorial identity leans on a serif display face, but `--font-serif` was
a pure system stack (`ui-serif, Georgia, "Times New Roman", serif`): macOS
and iOS visitors saw the intended register, Windows visitors saw Times New
Roman, and Linux varied further. The brand assets compounded the drift — the
satori-rendered OG share cards and the rasterised icon fallbacks used Inter
(the only font bundled at build time), so link previews didn't resemble the
site at all.

Spec §2 explicitly permits "properly licensed, locally hosted fonts". The
measure-first record §18 requires:

- **Observed problem:** platform-dependent display serif; OG cards and icon
  rasters in a sans face the site never shows.
- **Baseline:** zero runtime font requests; Lighthouse 100/100/100/100
  (93 perf on `/ask`).
- **Proposed change:** one self-hosted serif, headings only; body and mono
  stay system stacks.
- **Expected improvement:** the same editorial face on every OS, and share
  cards/icons rendered in the site's actual typeface.
- **Validation:** an e2e test pins exactly one font preload served from
  `/_astro/` with a font content type; the perf workflow's before/after
  Lighthouse numbers are recorded in the PR; both-scheme axe scans are
  unaffected (type only, no colour change).
- **Operational cost:** two latin woff2 subsets (~35KB total) on first
  visit, immutable-cached thereafter; one devDependency.

## Decision

Use Astro's fonts API (stable since 6.0) with the **fontsource provider**,
resolved from the local `@fontsource/source-serif-4` package:

- **Source Serif 4, weights 400 and 600, latin subset, normal style.**
  OFL-licensed — redistributable in ways Georgia never was, which is also
  why the icon rasteriser previously had to substitute Inter.
- `tokens.css` routes the existing token through the injected variable —
  `--font-serif: var(--font-display, ui-serif, Georgia, …)` — so deleting
  the config block reverts the entire site to the system stack.
- `BaseLayout` renders `<Font cssVariable="--font-display" preload>` for
  the **600 weight only** (site name and every heading paint with it; 400
  serves the tagline and note titles lazily). Astro emits size-adjusted
  fallback metrics, keeping CLS ≈ 0 during the swap.
- The OG-card renderer and icon rasteriser consume the same package:
  titles and the site name in Source Serif 4 600, supporting text in Inter 400. Share previews and pinned-tab icons now match the page.
- Files ship under `/_astro/` (immutable cache); `font-src 'self'` already
  allows them — no CSP change.

## Alternatives considered

- **Stay zero-webfont and re-render assets in an OFL serif only:** fixes
  the preview mismatch but leaves the on-page serif platform-dependent —
  rejected by the site owner in the 2026-07-24 design review.
- **Google provider:** fetches at build time — a network dependency and a
  licensing indirection the local fontsource package avoids.
- **Webfont for body text too:** rejected; the body sans is deliberately
  native, and the cost/benefit only clears for the display face.

## Consequences

- Every OS renders the same editorial serif; OG cards, icon fallbacks, and
  the live page finally share one face.
- First visit pays ~35KB across two woff2 files; repeat visits pay nothing.
- ADR-0010's social-card automation section is annotated: cards render in
  the site serif rather than Inter.
- The tokens.css contract is unchanged — components still consume
  `--font-serif` and never name the family directly, so a future family
  change stays a one-line config edit.

_(Amended 2026-07-24: the favicon joined the generated-asset pipeline as the
"accent-tick" mark — `scripts/build-logo.ts` renders the OG cards' accent
bar above a path-converted Source Serif 4 "EC" on the ink tile, which also
let `build-icons.ts` retire its font-embedding workaround.)_
