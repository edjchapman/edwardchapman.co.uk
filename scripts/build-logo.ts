/**
 * Pre-build favicon generation: the accent-tick mark — an ink tile carrying
 * the OG cards' accent bar above a Source Serif 4 "EC", rendered by satori
 * so the glyphs land as vector paths. Text-free SVG renders identically in
 * every browser tab and rasteriser, which is also what lets build-icons.ts
 * drop its font-embedding workaround. Colours come from the drift-guarded
 * palette mirror; the output is deterministic for a given font file.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import satori from "satori";

import { fontFile } from "../src/lib/og.ts";
import { PALETTE } from "../src/lib/palette.ts";

const TILE = 32;

export async function renderFaviconSvg(): Promise<string> {
  const serif = await fontFile(
    "source-serif-4",
    "source-serif-4-latin-600-normal.woff",
  );

  // The dark-scheme accent: the light one sits at ~1.8:1 on the ink tile
  // and vanishes; this reads on ink whatever the tab's theme.
  const mark = {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: PALETTE.light.ink,
        borderRadius: 6,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              left: 7,
              top: 8,
              width: 8,
              height: 2.5,
              backgroundColor: PALETTE.dark.accent,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              left: 0,
              top: 12,
              width: "100%",
              display: "flex",
              justifyContent: "center",
              fontFamily: "Source Serif 4",
              fontSize: 13.5,
              lineHeight: 1,
              color: PALETTE.light.paper,
            },
            children: "EC",
          },
        },
      ],
    },
  };

  const svg = await satori(mark as unknown as Parameters<typeof satori>[0], {
    width: TILE,
    height: TILE,
    fonts: [
      { name: "Source Serif 4", data: serif, weight: 600, style: "normal" },
    ],
  });

  // Fail loud if satori's output shape ever changes underneath us — the
  // paths-not-text property is the point of generating at all.
  if (!svg.includes(`viewBox="0 0 ${TILE} ${TILE}"`)) {
    throw new Error("build-logo: satori output lost its 32×32 viewBox");
  }
  if (!svg.includes("<path") || svg.includes("<text")) {
    throw new Error("build-logo: expected path-only SVG output");
  }
  return `${svg}\n`;
}

async function main(): Promise<void> {
  const svg = await renderFaviconSvg();
  await writeFile(join(process.cwd(), "public/favicon.svg"), svg);
  console.log(`build-logo: OK — favicon.svg (${svg.length} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
