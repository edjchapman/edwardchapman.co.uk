/**
 * Deterministic lexical retrieval (ADR-0005/0006): BM25-style scoring with
 * boosted titles/tags and a small curated synonym map, behind the `Retriever`
 * interface so a semantic implementation can replace it if the evidence bar
 * in ADR-0006 is ever met.
 */

import type { CorpusChunk } from "../../../scripts/build-agent-corpus.ts";

export interface ScoredChunk {
  chunk: CorpusChunk;
  score: number;
  /** Distinct query terms this chunk matched — feeds the confidence gate. */
  matchedTerms: number;
}

export interface Retriever {
  search(query: string, k: number): ScoredChunk[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "do",
  "does",
  "ed",
  "eds",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "s",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
  "about",
  "tell",
  "chapman",
  "chapmans",
]);

// Small curated technical vocabulary (spec §11): maps variants onto the
// token actually used in the corpus.
const SYNONYMS: Record<string, string[]> = {
  postgres: ["postgresql"],
  js: ["javascript"],
  ts: ["typescript"],
  k8s: ["kubernetes"],
  ml: ["ai"],
  llm: ["ai", "model"],
  evals: ["evaluation"],
  eval: ["evaluation"],
  cv: ["experience", "background"],
  resume: ["experience", "background"],
  résumé: ["experience", "background"],
  queue: ["celery", "outbox"],
  frontend: ["react", "typescript"],
  backend: ["platform", "django", "python"],
  email: ["contact"],
  reliable: ["reliability", "outbox", "idempotent"],
  reliability: ["outbox", "idempotent", "retries"],
  processing: ["process", "pipeline"],
  website: ["site"],
  deployed: ["deploy", "deployment", "ship"],
  deployment: ["deploy", "ship"],
};

/** Fold trivial plurals so "events" matches "event" on both sides. */
function foldPlural(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(foldPlural);
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) expanded.add(synonym);
  }
  return [...expanded];
}

type IndexedChunk = {
  chunk: CorpusChunk;
  termFreq: Map<string, number>;
  boostTerms: Set<string>;
  length: number;
};

export class LexicalRetriever implements Retriever {
  private readonly indexed: IndexedChunk[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  constructor(chunks: CorpusChunk[]) {
    this.indexed = chunks.map((chunk) => {
      const bodyTokens = tokenize(chunk.text);
      const boostTokens = tokenize(
        `${chunk.title} ${chunk.tags.join(" ")} ${chunk.docId.replaceAll("-", " ")}`,
      );
      const termFreq = new Map<string, number>();
      for (const token of [...bodyTokens, ...boostTokens]) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      return {
        chunk,
        termFreq,
        boostTerms: new Set(boostTokens),
        length: bodyTokens.length + boostTokens.length,
      };
    });

    for (const doc of this.indexed) {
      for (const term of doc.termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.avgLength =
      this.indexed.reduce((sum, doc) => sum + doc.length, 0) /
      Math.max(1, this.indexed.length);
  }

  search(query: string, k: number): ScoredChunk[] {
    const terms = expandQueryTokens(tokenize(query));
    if (terms.length === 0) return [];

    const totalDocs = this.indexed.length;
    const K1 = 1.4;
    const B = 0.6;
    const TITLE_BOOST = 1.6;

    const scored: ScoredChunk[] = [];
    for (const doc of this.indexed) {
      let score = 0;
      let matchedTerms = 0;
      for (const term of terms) {
        const frequency = doc.termFreq.get(term);
        if (!frequency) continue;
        matchedTerms += 1;
        const documentFrequency = this.docFreq.get(term) ?? 1;
        const idf = Math.log(
          1 + (totalDocs - documentFrequency + 0.5) / (documentFrequency + 0.5),
        );
        const normalized =
          (frequency * (K1 + 1)) /
          (frequency + K1 * (1 - B + (B * doc.length) / this.avgLength));
        const boost = doc.boostTerms.has(term) ? TITLE_BOOST : 1;
        score += idf * normalized * boost;
      }
      if (score > 0) scored.push({ chunk: doc.chunk, score, matchedTerms });
    }

    return scored
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.chunk.sectionId.localeCompare(b.chunk.sectionId),
      )
      .slice(0, k);
  }
}

/**
 * Refusal gate (spec §11 step 6): retrieval confidence below this means the
 * agent refuses rather than improvises. A single shared word (e.g. "London"
 * in a weather question) must never count as confident, so the top result
 * needs BOTH a minimum score and at least two distinct matched query terms.
 * Tuned against tests/agent/retrieval-cases.json — change only with the
 * fixtures.
 */
export const CONFIDENCE_THRESHOLD = 1.5;
export const MIN_MATCHED_TERMS = 2;

export function isConfident(results: ScoredChunk[]): boolean {
  const top = results[0];
  if (!top) return false;
  return (
    top.score >= CONFIDENCE_THRESHOLD && top.matchedTerms >= MIN_MATCHED_TERMS
  );
}
