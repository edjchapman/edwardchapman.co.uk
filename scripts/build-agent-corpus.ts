/**
 * Build-time corpus generator (ADR-0005, ADR-0007). Reads the published
 * content collections directly from src/content using the shared zod schemas,
 * excludes drafts and `corpus: false` entries, splits bodies into stable
 * sections at markdown heading boundaries, and emits a deterministic,
 * versioned artefact at src/generated/corpus.json — imported into the Worker
 * bundle, never served as a public asset.
 *
 * Stable-ID contract: docId = collection entry id (file name without
 * extension); sectionId = docId#heading-slug (or docId#intro / docId#card).
 * Renaming files or restructuring headings is a breaking corpus change —
 * update tests/agent/retrieval-cases.json in the same PR.
 *
 * The content-policy rules run over every emitted chunk as a final tripwire.
 *
 * Runs under plain Node (erasable-syntax TypeScript only).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  noteSchema,
  profileSchema,
  projectSchema,
} from "../src/lib/schemas.ts";
import { scanText, type PolicyConfig } from "./check-content-policy.ts";

export type CorpusChunk = {
  docId: string;
  sectionId: string;
  title: string;
  url: string;
  type: "project" | "note" | "profile";
  tags: string[];
  text: string;
};

export type Corpus = {
  version: string;
  generatedFrom: string;
  chunks: CorpusChunk[];
};

const ORIGIN = "https://edwardchapman.co.uk";

function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw };
  return {
    data: (parseYaml(match[1] ?? "") ?? {}) as Record<string, unknown>,
    body: match[2] ?? "",
  };
}

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Strip presentation-only markup, keeping the words. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```[a-z]*\n?/g, "").replace(/```$/, ""),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split a markdown body into (heading, text) sections at ## boundaries. */
export function splitSections(
  body: string,
): { heading: string | null; text: string }[] {
  const lines = body.split("\n");
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; buffer: string[] } = {
    heading: null,
    buffer: [],
  };

  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      sections.push({
        heading: current.heading,
        text: current.buffer.join("\n").trim(),
      });
      current = { heading: match[1] ?? "", buffer: [] };
    } else {
      current.buffer.push(line);
    }
  }
  sections.push({
    heading: current.heading,
    text: current.buffer.join("\n").trim(),
  });

  return sections.filter((section) => section.text.length > 0);
}

function readEntries(dir: string): { id: string; raw: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      id: name.replace(/\.md$/, ""),
      raw: readFileSync(join(dir, name), "utf8"),
    }));
}

export function buildCorpus(root: string): Corpus {
  const chunks: CorpusChunk[] = [];

  for (const entry of readEntries(join(root, "src/content/projects"))) {
    const { data, body } = parseFrontmatter(entry.raw);
    const parsed = projectSchema.parse(data);
    if (parsed.draft) continue;
    const url = `${ORIGIN}/projects/${entry.id}`;
    const tags = parsed.tech;

    chunks.push({
      docId: entry.id,
      sectionId: `${entry.id}#card`,
      title: parsed.title,
      url,
      type: "project",
      tags,
      text: stripMarkdown(
        `${parsed.problem}\n${parsed.built}\nDifferentiator: ${parsed.differentiator}`,
      ),
    });

    for (const section of splitSections(body)) {
      const slug = section.heading ? slugifyHeading(section.heading) : "intro";
      chunks.push({
        docId: entry.id,
        sectionId: `${entry.id}#${slug}`,
        title: section.heading
          ? `${parsed.title} — ${section.heading}`
          : parsed.title,
        url,
        type: "project",
        tags,
        text: stripMarkdown(section.text),
      });
    }
  }

  for (const entry of readEntries(join(root, "src/content/notes"))) {
    const { data, body } = parseFrontmatter(entry.raw);
    const parsed = noteSchema.parse(data);
    if (parsed.draft) continue;
    const url = `${ORIGIN}/notes/${entry.id}`;

    for (const section of splitSections(body)) {
      const slug = section.heading ? slugifyHeading(section.heading) : "intro";
      chunks.push({
        docId: entry.id,
        sectionId: `${entry.id}#${slug}`,
        title: section.heading
          ? `${parsed.title} — ${section.heading}`
          : parsed.title,
        url,
        type: "note",
        tags: parsed.tags,
        text: stripMarkdown(section.text),
      });
    }
  }

  for (const entry of readEntries(join(root, "src/content/profile"))) {
    const { data, body } = parseFrontmatter(entry.raw);
    const parsed = profileSchema.parse(data);
    if (!parsed.corpus) continue;
    // Profile prose renders on the homepage (colophon on its own page).
    const url = entry.id === "colophon" ? `${ORIGIN}/colophon` : `${ORIGIN}/`;
    const text = stripMarkdown(
      parsed.tagline ? `${parsed.tagline}\n${body}` : body,
    );

    chunks.push({
      docId: entry.id,
      sectionId: `${entry.id}#body`,
      title: parsed.title,
      url,
      type: "profile",
      tags: [],
      text,
    });
  }

  const canonical = JSON.stringify(chunks);
  return {
    version: createHash("sha256").update(canonical).digest("hex").slice(0, 16),
    generatedFrom: "src/content",
    chunks,
  };
}

export function policyViolations(root: string, corpus: Corpus): string[] {
  const config: PolicyConfig = JSON.parse(
    readFileSync(join(root, "scripts/content-policy-rules.json"), "utf8"),
  );
  const problems: string[] = [];
  for (const chunk of corpus.chunks) {
    // Corpus text ships inside the Worker; scan it as a shipping surface.
    const violations = scanText(`src/content/${chunk.sectionId}`, chunk.text, {
      ...config,
      rules: config.rules.filter((rule) => rule.id !== "noncanonical-origin"),
    });
    for (const violation of violations) {
      problems.push(
        `${chunk.sectionId}: [${violation.ruleId}] ${violation.excerpt}`,
      );
    }
  }
  return problems;
}

function main(): void {
  const root = process.cwd();
  const corpus = buildCorpus(root);

  const problems = policyViolations(root, corpus);
  if (problems.length > 0) {
    console.error("build-agent-corpus: policy violations in corpus output\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const outDir = join(root, "src/generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "corpus.json"),
    `${JSON.stringify(corpus, null, 2)}\n`,
  );
  console.log(
    `build-agent-corpus: OK — ${corpus.chunks.length} chunks, version ${corpus.version}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
