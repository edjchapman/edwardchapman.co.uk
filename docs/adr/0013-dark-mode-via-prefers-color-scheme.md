# ADR-0013: Dark mode via `prefers-color-scheme`, no toggle

**Status:** Accepted (2026-07-15)

## Context

Spec §18 (Phase 5) lists dark mode as possible future work, gated on a
measure-first justification; §7 warns against "overly elaborate dark mode" and
§19 names "dark-mode polishing" a non-goal. The site otherwise ships light-only
(`html { color-scheme: light }`; six colour tokens in `src/styles/tokens.css`),
so a visitor whose OS is set to dark gets a bright page regardless.

The measure-first record §18 requires:

- **Observed problem:** dark-OS / low-light visitors get a bright page; no way
  to match their environment.
- **Baseline:** light-only, `color-scheme: light`, no `prefers-color-scheme`.
- **Proposed change:** override the six colour tokens inside one
  `@media (prefers-color-scheme: dark)` block. Every component already consumes
  tokens and hardcodes no colour, so this recolours the whole site with no
  component edits.
- **Expected improvement:** the OS preference is respected automatically; better
  reading in low light and on OLED.
- **Validation:** axe (WCAG 2.2 AA) scans run in _both_ colour schemes in
  `tests/e2e/a11y.spec.ts`, plus E2E assertions that the correct paper colour is
  applied per scheme, plus a manual check.
- **Operational cost:** ~zero — no JavaScript, no new dependencies, no build or
  Worker changes; a few CSS declarations.

## Decision

- **CSS-only, system-driven, no toggle.** Dark mode follows
  `prefers-color-scheme`; there is no in-page control and nothing is persisted.
  This keeps the site 100% static with zero client JavaScript, so it needs no
  React island and stays within ADR-0003 (static-first) and ADR-0004 (React
  islands only) without amendment. It also degrades perfectly with JS disabled.
- **Token overrides only.** The dark block in `tokens.css` overrides the six
  colour tokens (plus a new `--color-error` token, promoted out of a lone
  hardcoded value in `ask.astro`); type, spacing, and radius are
  colour-independent and stay in `:root`. `color-scheme: light dark` on `html`
  lets native controls (form fields, scrollbars) follow suit.
- **Deliberately minimal**, honouring §7/§19: no theme switcher UI, no
  per-element dark tuning, no new fonts or effects.
- **Two adjacent UI fixes ride along** (same token layer, no new machinery):
  `clamp()` on the two largest type sizes for better mobile display, two
  media-scoped `theme-color` metas, and an `@media print` block that forces
  ink-on-white (which also stops a dark-OS visitor printing a dark page).

## Alternatives rejected

- **JS toggle + `localStorage`.** A manual override needs client JavaScript, a
  render-blocking `<head>` script to prevent a flash of the wrong theme, and
  no-JS dead-button handling — disproportionate machinery for a personal site
  and in tension with §7's restraint. System-driven covers the real need.
- **Three-way System / Light / Dark control.** More explicit, but more header
  chrome and closer to the "overly elaborate dark mode" §7 warns against.

## Consequences

- Visitors cannot override their OS setting; this is an accepted limitation of
  the minimal approach and can be revisited under §18 if a need is observed.
- Every future component must keep consuming colour tokens (no raw values) or it
  will not theme correctly — already the tokens.css contract, now load-bearing.
- Spec §18's Phase-5 list is annotated, not rewritten (as ADR-0010 did for RSS);
  the §19 "dark-mode _polishing_" non-goal stands — this is intentionally not
  that.

_(Amended 2026-07-24 by [ADR-0020](0020-motion-elevation-and-css-view-transitions.md):
the token set gained elevation/motion values and the dark raised surface was
retuned to `#262420` with verified ratios. The contract here — token-only
theming, system-driven, no toggle — is unchanged.)_
