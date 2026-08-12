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
    paper: "#faf9f6",
    ink: "#1a1a18",
    muted: "#5c5a54",
    accent: "#a84a1f",
    rule: "#e5e2da",
    ruleStrong: "#d9d5cb",
    paperRaised: "#ffffff",
    accentSubtle: "#f7ede5",
    error: "#a12733",
  },
  dark: {
    paper: "#171614",
    ink: "#eceae4",
    muted: "#a29d92",
    accent: "#e89a6b",
    rule: "#302e2a",
    ruleStrong: "#3a3833",
    paperRaised: "#262420",
    accentSubtle: "#33261c",
    error: "#f2a3ae",
  },
};
