/**
 * Pre-build icon-fallback generation (spec §9/§1: metadata and resilience).
 * Runs before `astro build`, same pattern as build-og-cards.ts — the
 * rasterizer (@resvg/resvg-js) is a native module the Worker bundler must
 * never see. Icons land in public/ (gitignored) and ship as static assets.
 *
 * favicon.svg sets font-family to a serif stack that real browsers resolve;
 * a headless rasterizer in CI has none of those fonts installed and
 * silently drops the glyphs, leaving a blank icon — confirmed empirically,
 * not a theoretical concern. To keep this build step deterministic across
 * machines, the source SVG's font-family is swapped for the bundled Source
 * Serif 4 (the site's own display face since ADR-0021) and embedded
 * explicitly with system font loading disabled — so the raster fallbacks
 * now match the serif identity instead of the old Inter stand-in. The
 * primary favicon (public/favicon.svg, linked directly) is untouched.
 *
 * Sizing deliberately does not use resvg's `fitTo` option: verified
 * empirically (installed @resvg/resvg-js 2.6.2) that `fitTo` has no effect
 * at all, in either direction, on both the pre-render Resvg instance size
 * and the rendered PNG — a library quirk, not a misuse of the API. Instead
 * this sets explicit width/height on the SVG root and leaves the existing
 * viewBox as the coordinate system, which is plain SVG scaling semantics
 * with no dependency on that option. If a future @resvg/resvg-js upgrade
 * fixes `fitTo`, this workaround can be dropped, but re-verify sizes first.
 *
 * Font loading uses `fontBuffers`, verified empirically to render correctly
 * with system fonts disabled — the typed `fontFiles` alternative (a file
 * path rather than a buffer) was tried first and renders blank, most likely
 * because resvg's font loader doesn't parse the .woff format @fontsource
 * ships. `fontBuffers` isn't in this version's bundled .d.ts even though
 * the native binding supports it (a types-lag-behind-native pattern common
 * to NAPI-RS bindings), hence the local type extension below rather than
 * `any`. Re-verify against `icon-*.png` output before trusting an upgrade.
 */

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);

type FontOptionsWithBuffers = NonNullable<ResvgRenderOptions["font"]> & {
  fontBuffers?: Buffer[];
};

const SIZES: { file: string; width: number }[] = [
  { file: "apple-touch-icon.png", width: 180 },
  { file: "icon-192.png", width: 192 },
  { file: "icon-512.png", width: 512 },
];

async function rasterize(root: string): Promise<number> {
  const serif = await readFile(
    require.resolve("@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff"),
  );
  const source = await readFile(join(root, "public/favicon.svg"), "utf-8");
  const svg = source.replace(
    /font-family="[^"]*"/,
    'font-family="Source Serif 4"',
  );
  const font: FontOptionsWithBuffers = {
    loadSystemFonts: false,
    fontBuffers: [serif],
  };

  for (const { file, width } of SIZES) {
    const sized = svg.replace(
      /<svg/,
      `<svg width="${width}" height="${width}"`,
    );
    const png = new Resvg(sized, { font }).render().asPng();
    await writeFile(join(root, "public", file), png);
  }
  return SIZES.length;
}

const root = process.cwd();
const written = await rasterize(root);
console.log(`build-icons: OK — ${written} icons into public/`);
