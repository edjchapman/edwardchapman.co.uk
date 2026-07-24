/**
 * Pre-build icon-fallback generation (spec §9/§1: metadata and resilience).
 * Runs after build-logo.ts and rasterises its output — the favicon is
 * path-only SVG (no text, no fonts), so the rasteriser needs no font
 * loading at all. That retired the previous font-embedding workaround
 * (font-family swap + a local `fontBuffers` type extension), which existed
 * only because the old favicon carried live text glyphs that headless
 * rasterisers silently dropped. `loadSystemFonts: false` stays as a
 * determinism guard: if text ever sneaks back into the SVG, CI renders it
 * blank everywhere rather than differently per machine.
 *
 * Sizing deliberately does not use resvg's `fitTo` option: verified
 * empirically (installed @resvg/resvg-js 2.6.2) that `fitTo` has no effect
 * at all, in either direction, on both the pre-render Resvg instance size
 * and the rendered PNG — a library quirk, not a misuse of the API. Instead
 * this normalises the SVG root's width/height attributes per size and
 * leaves the existing viewBox as the coordinate system, which is plain SVG
 * scaling semantics with no dependency on that option. If a future
 * @resvg/resvg-js upgrade fixes `fitTo`, this workaround can be dropped,
 * but re-verify sizes first.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Resvg } from "@resvg/resvg-js";

const SIZES: { file: string; width: number }[] = [
  { file: "apple-touch-icon.png", width: 180 },
  { file: "icon-192.png", width: 192 },
  { file: "icon-512.png", width: 512 },
];

async function rasterize(root: string): Promise<number> {
  const source = await readFile(join(root, "public/favicon.svg"), "utf-8");

  for (const { file, width } of SIZES) {
    const sized = source.replace(/<svg([^>]*)>/, (_, attrs: string) => {
      const kept = attrs.replace(/\s(width|height)="[^"]*"/g, "").trim();
      return `<svg width="${width}" height="${width}" ${kept}>`;
    });
    const png = new Resvg(sized, {
      font: { loadSystemFonts: false },
    })
      .render()
      .asPng();
    await writeFile(join(root, "public", file), png);
  }
  return SIZES.length;
}

const root = process.cwd();
const written = await rasterize(root);
console.log(`build-icons: OK — ${written} icons into public/`);
