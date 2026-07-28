/**
 * Build-time generator for the pre-answered baseline (ADR-0027). Reads
 * reviewed answer files from src/content/ask-baseline, strips their
 * `[[sectionId]]` citation markers into answer text plus per-claim spans,
 * resolves those sections to canonical sources against the freshly-built
 * corpus, and emits a deterministic, versioned artifact at
 * src/generated/baseline.json — imported into the Worker bundle, never served.
 *
 * The corpus is rebuilt in-process (same as scripts/run-agent-evals.ts) so an
 * answer citing a section that no longer exists fails the build — a staleness
 * tripwire mirroring build-agent-corpus's own policy re-scan. The
 * content-policy rules run over every answer, since the text ships in the
 * Worker.
 *
 * Runs under plain Node (erasable-syntax TypeScript only).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import type { CitationSpan } from "../src/components/ask-citations.ts";
import {
  normalizeBaselineKey,
  type BaselineAnswers,
  type BaselineEntry,
} from "../src/lib/agent/baseline.ts";
import { buildCorpus, type Corpus } from "./build-agent-corpus.ts";
import { scanText, type PolicyConfig } from "./check-content-policy.ts";

const MARKER = /\[\[([^\]]+)\]\]/g;

type Mark = { sectionId: string; start: number; end: number };

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

function trimSpan(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from] ?? "")) from += 1;
  while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
  return from < to ? { start: from, end: to } : null;
}

/**
 * Strip `[[sectionId]]` markers into clean answer text plus one span per
 * marker, each covering the claim text since the previous marker (mirrors the
 * model's per-claim citation spans).
 */
export function extractCitations(body: string): {
  answer: string;
  marks: Mark[];
} {
  const source = body.trim();
  let answer = "";
  let claimStart = 0;
  let cursor = 0;
  const marks: Mark[] = [];
  for (const match of source.matchAll(MARKER)) {
    answer += source.slice(cursor, match.index);
    const span = trimSpan(answer, claimStart, answer.length);
    if (span) {
      marks.push({ sectionId: (match[1] ?? "").trim(), ...span });
    }
    claimStart = answer.length;
    cursor = (match.index ?? 0) + match[0].length;
  }
  answer += source.slice(cursor);
  return { answer: answer.trim(), marks };
}

/**
 * Resolve cited sectionIds to sources against the corpus: dedupe by URL (two
 * sections of one page share a number), order by first appearance, remap spans
 * onto that ordering. `unknown` lists sectionIds absent from the corpus — the
 * staleness tripwire.
 */
function resolveSources(
  marks: Mark[],
  corpus: Corpus,
): {
  citations: CitationSpan[];
  sources: { title: string; url: string }[];
  citedSectionIds: string[];
  unknown: string[];
} {
  const chunkBySectionId = new Map(
    corpus.chunks.map((chunk) => [chunk.sectionId, chunk]),
  );
  const sources: { title: string; url: string }[] = [];
  const indexByUrl = new Map<string, number>();
  const citations: CitationSpan[] = [];
  const citedSectionIds: string[] = [];
  const unknown: string[] = [];

  for (const mark of marks) {
    const chunk = chunkBySectionId.get(mark.sectionId);
    if (!chunk) {
      unknown.push(mark.sectionId);
      continue;
    }
    let sourceIndex = indexByUrl.get(chunk.url);
    if (sourceIndex === undefined) {
      sourceIndex = sources.length;
      indexByUrl.set(chunk.url, sourceIndex);
      sources.push({ title: chunk.title, url: chunk.url });
    }
    citations.push({ start: mark.start, end: mark.end, sourceIndex });
    if (!citedSectionIds.includes(mark.sectionId)) {
      citedSectionIds.push(mark.sectionId);
    }
  }
  return { citations, sources, citedSectionIds, unknown };
}

function readEntryFiles(dir: string): { id: string; raw: string }[] {
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

export function buildBaselineAnswers(root: string): BaselineAnswers {
  const corpus = buildCorpus(root);
  const entries: BaselineEntry[] = [];

  for (const file of readEntryFiles(join(root, "src/content/ask-baseline"))) {
    const { data, body } = parseFrontmatter(file.raw);
    const question = typeof data.question === "string" ? data.question : "";
    const aliases = Array.isArray(data.aliases)
      ? data.aliases.filter((a): a is string => typeof a === "string")
      : [];
    const { answer, marks } = extractCitations(body);
    const { citations, sources, citedSectionIds } = resolveSources(
      marks,
      corpus,
    );
    const questionKeys = [
      ...new Set([question, ...aliases].map(normalizeBaselineKey)),
    ];
    entries.push({
      id: file.id,
      question,
      questionKeys,
      answer,
      citations,
      sources,
      citedSectionIds,
    });
  }

  const canonical = JSON.stringify(entries);
  return {
    version: createHash("sha256").update(canonical).digest("hex").slice(0, 16),
    corpusVersion: corpus.version,
    generatedFrom: "src/content/ask-baseline",
    entries,
  };
}

/** All build-failing problems, collected so one run reports them all. */
export function baselineProblems(
  root: string,
  artifact: BaselineAnswers,
): string[] {
  const corpus = buildCorpus(root);
  const known = new Set(corpus.chunks.map((chunk) => chunk.sectionId));
  const config: PolicyConfig = JSON.parse(
    readFileSync(join(root, "scripts/content-policy-rules.json"), "utf8"),
  );
  const problems: string[] = [];
  const seenKeys = new Map<string, string>();

  for (const entry of artifact.entries) {
    if (entry.question.trim() === "") {
      problems.push(`${entry.id}: missing frontmatter question`);
    }
    if (entry.answer.trim() === "") {
      problems.push(`${entry.id}: empty answer`);
    }
    if (entry.citations.length === 0) {
      problems.push(`${entry.id}: no [[sectionId]] citation markers`);
    }
    // Staleness: a cited section absent from the corpus (renamed/removed).
    for (const sectionId of entry.citedSectionIds) {
      if (!known.has(sectionId)) {
        problems.push(`${entry.id}: cites unknown section ${sectionId}`);
      }
    }
    // Span invariants (the response contract, spec §10): half-open, in-bounds,
    // ascending, pointing at a real source.
    let previousStart = -1;
    for (const span of entry.citations) {
      if (span.start >= span.end || span.end > entry.answer.length) {
        problems.push(`${entry.id}: span out of range`);
      }
      if (span.sourceIndex >= entry.sources.length) {
        problems.push(`${entry.id}: sourceIndex out of range`);
      }
      if (span.start < previousStart) {
        problems.push(`${entry.id}: spans not sorted ascending`);
      }
      previousStart = span.start;
    }
    // Duplicate normalised key across entries — the lookup would be ambiguous.
    for (const key of entry.questionKeys) {
      const owner = seenKeys.get(key);
      if (owner) {
        problems.push(`${entry.id}: duplicate question key with ${owner}`);
      } else {
        seenKeys.set(key, entry.id);
      }
    }
    // The answer + question ship in the Worker: scan as a shipping surface.
    const scanned = `${entry.question}\n${entry.questionKeys.join("\n")}\n${entry.answer}`;
    const violations = scanText(
      `src/content/ask-baseline/${entry.id}`,
      scanned,
      {
        ...config,
        rules: config.rules.filter((rule) => rule.id !== "noncanonical-origin"),
      },
    );
    for (const violation of violations) {
      problems.push(`${entry.id}: [${violation.ruleId}] ${violation.excerpt}`);
    }
  }
  return problems;
}

function main(): void {
  const root = process.cwd();
  const artifact = buildBaselineAnswers(root);

  const problems = baselineProblems(root, artifact);
  if (problems.length > 0) {
    console.error("build-baseline-answers: problems in baseline output\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const outDir = join(root, "src/generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "baseline.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  const cited = artifact.entries.reduce(
    (sum, entry) => sum + entry.citedSectionIds.length,
    0,
  );
  console.log(
    `build-baseline-answers: OK — ${artifact.entries.length} entries, ` +
      `${cited} citations, version ${artifact.version}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
