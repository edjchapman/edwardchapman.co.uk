import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { PALETTE } from "../../src/lib/palette";

// Drift tripwire (ADR-0020): palette.ts mirrors tokens.css for the consumers
// CSS custom properties can't reach (theme-color metas, satori OG cards).
// Every mirrored hex must appear in the matching scheme block of the real
// stylesheet, so a token retune that skips the mirror fails here.

let lightBlock: string;
let darkBlock: string;

beforeAll(async () => {
  const css = await readFile("src/styles/tokens.css", "utf8");
  const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
  expect(darkStart).toBeGreaterThan(-1);
  lightBlock = css.slice(0, darkStart);
  darkBlock = css.slice(darkStart);
});

describe("palette.ts mirrors tokens.css", () => {
  it("every light value appears in the light block", () => {
    for (const [name, hex] of Object.entries(PALETTE.light)) {
      expect(lightBlock, `light ${name} (${hex})`).toContain(hex);
    }
  });

  it("every dark value appears in the dark block", () => {
    for (const [name, hex] of Object.entries(PALETTE.dark)) {
      expect(darkBlock, `dark ${name} (${hex})`).toContain(hex);
    }
  });

  it("the schemes mirror the same token set", () => {
    expect(Object.keys(PALETTE.dark).sort()).toEqual(
      Object.keys(PALETTE.light).sort(),
    );
  });
});
