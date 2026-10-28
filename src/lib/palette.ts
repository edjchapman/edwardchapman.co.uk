/**
 * TypeScript mirror of the colour tokens in src/styles/tokens.css, for the
 * places CSS custom properties can't reach: the `theme-color` metas in
 * BaseLayout.astro and the satori-rendered OG cards (src/lib/og.ts).
 * tests/unit/design-tokens.test.ts asserts every value here appears in the
 * matching scheme block of tokens.css, so the two can't drift silently.
 */

export interface PaletteScheme {
  readonly paper: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly rule: string;
  readonly ruleStrong: string;
  readonly paperRaised: string;
  readonly accentSubtle: string;
  readonly error: string;
}

export const PALETTE: {
  readonly light: PaletteScheme;
  readonly dark: PaletteScheme;
} = {
  light: {
    paper: "#f5f6f4",
    ink: "#161a19",
    muted: "#545c5a",
    accent: "#1f6b5c",
    rule: "#e1e4e1",
    ruleStrong: "#d2d7d3",
    paperRaised: "#ffffff",
    accentSubtle: "#e4eeea",
    error: "#a12733",
  },
  dark: {
    paper: "#131615",
    ink: "#e6eae8",
    muted: "#9aa39f",
    accent: "#6fbfa9",
    rule: "#2a2f2d",
    ruleStrong: "#353b39",
    paperRaised: "#212625",
    accentSubtle: "#1a2b27",
    error: "#f2a3ae",
  },
};
