/**
 * Build-time social-card rendering (spec §9). Runs only from
 * scripts/build-og-cards.ts before `astro build`, so satori/resvg (a native
 * module) and the font files never enter the Worker bundle — cards land in
 * public/og/ and ship as static assets like any other image.
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { PALETTE } from "./palette.ts";
import { SITE } from "./site.ts";

// Cards render in the light scheme — satori can't read CSS custom
// properties, so the palette module is the drift-guarded bridge.
const TOKENS = PALETTE.light;

const require = createRequire(import.meta.url);

async function fontFile(pkg: string, file: string): Promise<Buffer> {
  return readFile(require.resolve(`@fontsource/${pkg}/files/${file}`));
}

/** Long titles step down so they never clip the 1200×630 canvas. */
function titleSize(title: string): number {
  if (title.length <= 40) return 72;
  if (title.length <= 70) return 58;
  return 48;
}

export async function renderOgCard(
  title: string,
  kicker: string,
): Promise<Uint8Array> {
  // Mirrors the live page's split: display serif for the title and site
  // name (ADR-0021 — the same family the site loads), sans for supporting
  // text.
  const [sans, serif] = await Promise.all([
    fontFile("inter", "inter-latin-400-normal.woff"),
    fontFile("source-serif-4", "source-serif-4-latin-600-normal.woff"),
  ]);

  // Satori's signature says ReactNode, but it documents plain element
  // objects as valid input — this keeps React out of build scripts.
  const card = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px 80px",
        backgroundColor: TOKENS.paper,
        color: TOKENS.ink,
        fontFamily: "Inter",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: 96,
                    height: 8,
                    backgroundColor: TOKENS.accent,
                    marginBottom: 40,
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 26,
                    letterSpacing: "0.08em",
                    color: TOKENS.muted,
                    marginBottom: 24,
                  },
                  children: kicker.toUpperCase(),
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Source Serif 4",
                    fontSize: titleSize(title),
                    fontWeight: 600,
                    lineHeight: 1.12,
                    maxWidth: 1000,
                  },
                  children: title,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: `2px solid ${TOKENS.rule}`,
              paddingTop: 32,
              fontSize: 30,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { fontFamily: "Source Serif 4", fontWeight: 600 },
                  children: SITE.name,
                },
              },
              {
                type: "div",
                props: {
                  style: { color: TOKENS.muted },
                  children: "edwardchapman.co.uk",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(card as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Inter", data: sans, weight: 400, style: "normal" },
      { name: "Source Serif 4", data: serif, weight: 600, style: "normal" },
    ],
  });

  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } })
    .render()
    .asPng();
}
