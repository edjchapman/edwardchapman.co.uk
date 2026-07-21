/**
 * Pre-build llms.txt generation (spec §9: generate it from published content
 * or maintain it through a documented process — this is the former). Runs
 * before `astro build`, same pattern as build-og-cards.ts, so the file ships
 * as a static asset. It restates only already-published sources: non-draft
 * collection frontmatter and the SITE constants. A discovery aid, not a
 * security boundary; the content-policy scanner still covers the output.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { parse as parseYaml } from "yaml";

import { SITE } from "../src/lib/site.ts";
import { noteSchema, projectSchema } from "../src/lib/schemas.ts";
import type { Note, Project } from "../src/lib/schemas.ts";

type Entry<T> = { slug: string; data: T };

function frontmatter(raw: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  return (parseYaml(match?.[1] ?? "") ?? {}) as Record<string, unknown>;
}

async function collect<T extends { draft: boolean }>(
  root: string,
  dir: string,
  parse: (data: unknown) => T,
): Promise<Entry<T>[]> {
  const base = join(root, "src/content", dir);
  const entries: Entry<T>[] = [];
  for (const file of (await readdir(base)).filter((f) => f.endsWith(".md"))) {
    const data = parse(frontmatter(await readFile(join(base, file), "utf8")));
    if (data.draft) continue;
    entries.push({ slug: file.replace(/\.md$/, ""), data });
  }
  return entries;
}

/** Fixed pages and their one-line purposes (the collections fill the rest). */
const HOME_BLURB =
  "positioning, selected projects, how I work, technical focus, contact";

const PAGES: ReadonlyArray<{ path: string; label: string; blurb: string }> = [
  {
    path: "/experience",
    label: "Experience",
    blurb:
      "work history and roles with dates, education, technology depth, and leadership",
  },
  {
    path: "/ask",
    label: "Ask",
    blurb:
      "ask questions about Ed's published work and get grounded, cited answers — refuses when the site doesn't cover it",
  },
  {
    path: "/colophon",
    label: "Colophon",
    blurb:
      "how this site is built — Astro on Cloudflare Workers, static-first, spec-driven, gated by CI",
  },
  {
    path: "/privacy",
    label: "Privacy",
    blurb: "no analytics, no cookies, no tracking",
  },
];

export function renderLlmsText(
  projects: Entry<Project>[],
  notes: Entry<Note>[],
): string {
  const byOrder = [...projects].sort((a, b) => a.data.order - b.data.order);
  const newestFirst = [...notes].sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  const projectPageLinks = byOrder
    .map((p) => `[${p.data.title}](${SITE.origin}/projects/${p.slug})`)
    .join(", ");
  const notePageLinks = newestFirst
    .map((n) => `[${n.data.title}](${SITE.origin}/notes/${n.slug})`)
    .join(", ");

  const pages = [
    `- [Home](${SITE.origin}/): ${HOME_BLURB}`,
    `- [Projects](${SITE.origin}/projects): case studies with architecture, decisions, limitations, and next steps — ${projectPageLinks}`,
    `- [Notes](${SITE.origin}/notes): technical writing — ${notePageLinks}`,
    ...PAGES.map(
      (page) => `- [${page.label}](${SITE.origin}${page.path}): ${page.blurb}`,
    ),
  ];

  const repos = byOrder.map((p) => {
    const demo = p.data.demo ? ` Demo: ${p.data.demo}` : "";
    return `- [${p.data.title}](${p.data.repo}): ${p.data.built}${demo}`;
  });

  return [
    `# ${SITE.name} — edwardchapman.co.uk`,
    "",
    `> ${SITE.description}`,
    "",
    "Generated at build time from the published content collections by",
    "scripts/build-llms-txt.ts (docs/spec.md §9). This file is a discovery",
    "aid, not a security boundary.",
    "",
    "## Pages",
    "",
    ...pages,
    "",
    "## Projects",
    "",
    ...repos,
    "",
    "## Source",
    "",
    `- [This site's repository](${SITE.repo}): commissioning spec, architecture decision records, quality gates, and deployment pipeline — all public`,
    "",
    "## Contact",
    "",
    `- Email: ${SITE.email}`,
    `- GitHub: ${SITE.github}`,
    `- LinkedIn: ${SITE.linkedin}`,
    "",
  ].join("\n");
}

export async function buildLlmsText(root: string): Promise<string> {
  const projects = await collect(root, "projects", (d) =>
    projectSchema.parse(d),
  );
  const notes = await collect(root, "notes", (d) => noteSchema.parse(d));
  return renderLlmsText(projects, notes);
}

const invokedDirectly = process.argv[1]?.endsWith("build-llms-txt.ts") ?? false;
if (invokedDirectly) {
  const root = process.cwd();
  const text = await buildLlmsText(root);
  await writeFile(join(root, "public/llms.txt"), text);
  console.log(
    `build-llms-txt: OK — public/llms.txt (${text.split("\n").length} lines)`,
  );
}
