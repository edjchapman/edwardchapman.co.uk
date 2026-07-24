# ADR-0020: Motion and elevation vocabulary, CSS-only view transitions

**Status:** Accepted (2026-07-24)

## Context

The 2026-07-24 design review measured the visual system against the spec's
§7 qualities ("subtle visual detail", "excellent mobile experience", motion
"only where it improves state communication") and found three structural
gaps rather than styling bugs:

- **No motion vocabulary.** Zero `transition`/`@keyframes` existed anywhere;
  every hover and focus state snapped. The global `prefers-reduced-motion`
  reset guarded animations that did not exist.
- **No elevation vocabulary.** Every surface was `--color-paper-raised` plus
  a 1px `--color-rule` border. In the dark scheme the raised surface
  (`#201e1b`) sat at ~1.09:1 against the page (`#171614`) — cards, asides,
  and the ask answer box were nearly indistinguishable from the background.
- **Full-page navigations cut hard.** The site is a zero-JS MPA by design
  (ADR-0003/0004), so it had no navigation continuity at all.

The measure-first record spec §18 requires:

- **Observed problem:** as above, from the review's code audit and live
  screenshots (1440px/390px, both schemes).
- **Baseline:** no motion tokens; six colour tokens; dark figure/ground
  1.09:1; instant navigation everywhere.
- **Validation:** axe (WCAG 2.2 AA) in both schemes over every page
  including `/ask`; pinned computed values for the dark raised surface and
  the reduced-motion transition duration; `headers.spec` proving the CSP is
  untouched.
- **Operational cost:** ~zero — CSS only; no dependencies, no Worker or
  build changes.

## Decision

1. **Motion tokens, state-communication only.** One easing
   (`--ease-out: cubic-bezier(0.2, 0, 0, 1)`) and two durations:
   `--duration-quick` (120ms) for colour/border feedback and
   `--duration-gentle` (200ms) for elevation and reveals. Consumed by link
   colours, hero pills, nav/footer/breadcrumb hovers, the ask controls, and
   a single fade-in on the ask answer. The existing global reduced-motion
   reset disables all of it wholesale; a test asserts the computed
   `transitionDuration` is `0s` under emulation.

2. **Elevation tokens.** Two shadow steps (`--shadow-1`, `--shadow-2`) —
   ink-derived in light, true black in dark, `none` in print — plus
   `--color-rule-strong` for borders that carry a surface. The dark raised
   surface steps up to `#262420` so surface, border, and shadow together
   carry figure/ground. All text-on-raised pairs hold ≥ 4.5:1 (muted 5.73,
   accent 6.90, ink 12.88); `--color-accent-subtle` panels likewise (ink
   15.50/12.49, accent 5.59/6.69). Enforcement stays mechanical: both-scheme
   axe scans plus pinned computed colours in `a11y.spec`.

3. **Cross-document view transitions, CSS only.** A single
   `@view-transition { navigation: auto }` block in `global.css`, wrapped in
   `@media (prefers-reduced-motion: no-preference)` (the universal reset
   cannot reach `::view-transition-*` pseudo-elements), with the root
   animation timed by `--duration-gentle`. Support at decision time:
   Chrome/Edge 126+, Safari 18.2+; Firefox not yet shipped — those browsers
   keep today's instant navigation. Progressive enhancement, zero bytes of
   JavaScript, no CSP change. Two hard-won details: the `::view-transition`
   overlay gets `pointer-events: none` so a click made during the animation
   is not swallowed, and the Playwright suite runs with
   `reducedMotion: "reduce"` — headless Chromium never settles a
   cross-document transition, hanging actionability checks, so e2e
   exercises the reduce-preference path and the transition itself is
   verified manually.

4. **A TypeScript palette mirror.** `src/lib/palette.ts` carries the colour
   tokens for the two consumers CSS custom properties cannot reach — the
   `theme-color` metas (previously hard-coded hexes) and the satori-rendered
   OG cards. `tests/unit/design-tokens.test.ts` asserts every mirrored value
   appears in the matching scheme block of `tokens.css`, replacing silent
   duplication with a drift tripwire.

## Alternatives considered

- **Astro's `<ClientRouter />` (view transitions with SPA routing):**
  rejected — it ships a router runtime on every page, breaking the
  "zero client-side JavaScript outside the ask island" property that
  ADR-0004 institutionalises and the colophon publicly claims.
- **`prefetch: true`:** rejected for the same reason — Astro's prefetch
  injects a client script into every page for negligible gain on <50KB
  edge-served HTML. Revisit only if navigation latency is ever measured as
  a real problem.
- **An elevation system with more steps:** rejected — two steps cover the
  site's actual surfaces (resting cards; the one emphasised answer box);
  more would be vocabulary without use.

## Consequences

- Hover/focus states communicate; dark-mode surfaces separate; supported
  browsers get navigation continuity — all without JavaScript, new
  dependencies, or CSP changes.
- The token layer grows by three colour tokens, two shadows, and three
  motion values; ADR-0013's token-only theming contract is unchanged
  (amended there in one line).
- `theme-color` and OG-card colours can no longer drift from the
  stylesheet unnoticed.
- Firefox visitors see no view transitions until it ships cross-document
  support; nothing degrades.
