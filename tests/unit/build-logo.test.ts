import { describe, expect, it } from "vitest";

import { renderFaviconSvg } from "../../scripts/build-logo";
import { PALETTE } from "../../src/lib/palette";

// The accent-tick mark (ADR-0021 amendment): path-true SVG so every tab,
// rasteriser, and OS renders the same glyphs — the property build-icons.ts
// now relies on to skip font loading entirely.

describe("build-logo", () => {
  it("emits a 32×32 path-only SVG — no live text", async () => {
    const svg = await renderFaviconSvg();
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
  });

  it("uses only palette colours: ink tile, paper glyphs, dark-accent tick", async () => {
    const svg = await renderFaviconSvg();
    expect(svg).toContain(PALETTE.light.ink);
    expect(svg).toContain(PALETTE.light.paper);
    // The dark-scheme accent by design — the light accent is near-invisible
    // on the ink tile.
    expect(svg).toContain(PALETTE.dark.accent);
    expect(svg).not.toContain(PALETTE.light.accent);
  });

  it("is deterministic across runs", async () => {
    expect(await renderFaviconSvg()).toBe(await renderFaviconSvg());
  });
});
