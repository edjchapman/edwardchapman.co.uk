/**
 * Pre-answered baseline questions (ADR-0027): a build-time artifact of
 * reviewed answers to known questions, matched by exact key so common
 * questions are served without a model call — zero cost, zero latency, and
 * outage-proof. Not retrieval (ADR-0005/0006 are untouched): a `Map` keyed on
 * the normalised question, no scoring. This runtime module is shared with the
 * build script (`scripts/build-baseline-answers.ts`), which produces the
 * artifact this consumes.
 */

import type { CitationSpan } from "../../components/ask-citations.ts";

export interface BaselineEntry {
  /** Source filename without extension; also the `ask.baseline_served` detail. */
  id: string;
  /** Display form of the question (the primary key before normalisation). */
  question: string;
  /** Primary + alias questions, pre-normalised at build time. */
  questionKeys: string[];
  /** Answer text with `[[sectionId]]` citation markers stripped. */
  answer: string;
  /** Half-open spans into `answer`, resolved to `sources` at build time. */
  citations: CitationSpan[];
  sources: { title: string; url: string }[];
  /** The corpus sections this answer cites — the staleness-tripwire surface. */
  citedSectionIds: string[];
}

export interface BaselineAnswers {
  /** sha256 prefix of the canonical entries (ADR-0005 versioning pattern). */
  version: string;
  /** The corpus version the sources were resolved against, cross-checked. */
  corpusVersion: string;
  generatedFrom: string;
  entries: BaselineEntry[];
}

/**
 * The one normalisation both the build (key generation) and the runtime
 * (lookup) apply, so an entry authored one way still matches a visitor typing
 * it another. Deliberately conservative — exact match after this transform,
 * never fuzzy (ADR-0027): serving a wrong canned answer is worse than a model
 * call, so anything past whitespace/case/trailing-punctuation must be a
 * curated alias, not a guess. The request schema already collapses whitespace
 * and trims; this re-applies it so callers that bypass the schema still match.
 */
export function normalizeBaselineKey(question: string): string {
  return question
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/’/g, "'") // iOS smart apostrophe → straight
    .replace(/[?!.…]+$/, "")
    .trim();
}

/**
 * Build a lookup over an artifact once (module init in the route), returning a
 * matcher from a raw question to its entry, or undefined for a miss. A
 * duplicate normalised key across entries is a build-time error, so the map is
 * unambiguous here.
 */
export function createBaselineLookup(
  artifact: BaselineAnswers,
): (question: string) => BaselineEntry | undefined {
  const byKey = new Map<string, BaselineEntry>();
  for (const entry of artifact.entries) {
    for (const key of entry.questionKeys) byKey.set(key, entry);
  }
  return (question: string) => byKey.get(normalizeBaselineKey(question));
}
