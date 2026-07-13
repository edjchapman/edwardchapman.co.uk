/**
 * Pre-build social-card generation (spec §9: social card images). Runs before
 * `astro build` — same pattern as build-agent-corpus.ts — because the
 * rasterizer (@resvg/resvg-js) is a native module the Worker bundler must
 * never see. Cards land in public/og/ (gitignored) and ship as static assets.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { parse as parseYaml } from "yaml";

import { renderOgCard } from "../src/lib/og.ts";
import { noteSchema, projectSchema } from "../src/lib/schemas.ts";

type Card = { slug: string; title: string };

function frontmatter(raw: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  return (parseYaml(match?.[1] ?? "") ?? {}) as Record<string, unknown>;
}

async function collect(
  root: string,
  dir: string,
  parse: (data: unknown) => { title: string; draft: boolean },
): Promise<Card[]> {
  const base = join(root, "src/content", dir);
  const cards: Card[] = [];
  for (const file of (await readdir(base)).filter((f) => f.endsWith(".md"))) {
    const data = parse(frontmatter(await readFile(join(base, file), "utf8")));
    if (data.draft) continue;
    cards.push({ slug: file.replace(/\.md$/, ""), title: data.title });
  }
  return cards;
}

async function write(
  root: string,
  kind: string,
  kicker: string,
  cards: Card[],
): Promise<number> {
  const outDir = join(root, "public/og", kind);
  await mkdir(outDir, { recursive: true });
  for (const card of cards) {
    const png = await renderOgCard(card.title, kicker);
    await writeFile(join(outDir, `${card.slug}.png`), png);
  }
  return cards.length;
}

const root = process.cwd();
const projects = await collect(root, "projects", (d) => projectSchema.parse(d));
const notes = await collect(root, "notes", (d) => noteSchema.parse(d));
const written =
  (await write(root, "projects", "Project case study", projects)) +
  (await write(root, "notes", "Note", notes));
console.log(`build-og-cards: OK — ${written} cards into public/og/`);
