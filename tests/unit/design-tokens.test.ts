import { glob, readFile } from "node:fs/promises";

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

// The manifest is static JSON with no build step, so it can't import the
// palette; without this it silently kept the pre-ADR-0030 paper.
describe("site.webmanifest follows the palette", () => {
  it("theme and background colours are the light paper", async () => {
    const manifest = JSON.parse(
      await readFile("public/site.webmanifest", "utf8"),
    ) as { theme_color: string; background_color: string };
    expect(manifest.theme_color).toBe(PALETTE.light.paper);
    expect(manifest.background_color).toBe(PALETTE.light.paper);
  });
});

// An undefined custom property invalidates the whole declaration silently —
// ADR-0030's --rail and --text-xs both shipped that way before review.
describe("every custom property used in src/ is defined", () => {
  // Injected at build time by Astro's fonts API (astro.config.ts); every use
  // carries a var() fallback, so they may be absent in the source.
  const INJECTED = new Set(["--font-display", "--font-data"]);

  it("has a definition for each var() reference", async () => {
    const used = new Set<string>();
    const defined = new Set<string>();
    for await (const file of glob("src/**/*.{astro,css,tsx}")) {
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g))
        used.add(m[1] ?? "");
      for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g))
        defined.add(m[1] ?? "");
    }
    const missing = [...used].filter(
      (v) => !defined.has(v) && !INJECTED.has(v),
    );
    expect(missing).toEqual([]);
  });
});
