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
  /**
   * Of the matched terms, how many are document-identity tokens (docId words,
   * e.g. "foreman") — lets the gate trust strong single-term entity questions.
   */
  matchedEntityTerms: number;
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
  "can",
  "could",
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
  "may",
  "might",
  "must",
  "s",
  "shall",
  "should",
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
  "will",
  "with",
  "would",
  "you",
  "your",
  "about",
  "tell",
  "chapman",
  "chapmans",
]);

// Small curated vocabulary (spec §11): maps query variants onto the tokens
// actually used in the corpus. Keys are matched AFTER tokenize() folds trivial
// plurals, so plural forms are keyed in their folded shape ("skills" → "skill",
// "technologies" → "technologie", "languages" → "language").
const SYNONYMS: Record<string, string[]> = {
  // Technical variants → the corpus's spelling.
  postgres: ["postgresql"],
  js: ["javascript"],
  ts: ["typescript"],
  k8s: ["kubernetes"],
  ml: ["ai"],
  llm: ["ai", "model"],
  evals: ["evaluation"],
  eval: ["evaluation"],
  queue: ["celery", "outbox"],
  frontend: ["react", "typescript"],
  backend: ["platform", "django", "python"],
  reliable: ["reliability", "outbox", "idempotent"],
  reliability: ["outbox", "idempotent", "retries"],
  processing: ["process", "pipeline"],
  website: ["site"],
  deployed: ["deploy", "deployment", "ship"],
  deployment: ["deploy", "ship"],
  // Recruiter/professional vocabulary → the profile's own wording. A visitor
  // asks about "background" and "technologies"; the positioning prose says
  // "senior engineer", "Python", "TypeScript". Without this bridge the highest-
  // intent questions share no lexical terms with the corpus and refuse.
  cv: ["senior", "engineer", "role"],
  resume: ["senior", "engineer", "role"],
  résumé: ["senior", "engineer", "role"],
  background: ["senior", "engineer", "role"],
  experience: ["senior", "engineer", "role"],
  career: ["senior", "role"],
  professional: ["senior", "engineer"],
  technologie: ["python", "typescript", "aws"],
  technology: ["python", "typescript", "aws"],
  language: ["python", "typescript", "kotlin"],
  tech: ["python", "typescript", "aws"],
  stack: ["python", "django", "typescript", "aws"],
  skill: ["python", "typescript", "aws"],
  tool: ["terraform", "docker", "aws"],
  domain: ["proptech", "logistics", "energy"],
  industrie: ["proptech", "logistics", "energy"],
  industry: ["proptech", "logistics", "energy"],
  email: ["contact"],
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
  entityTerms: Set<string>;
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
        entityTerms: new Set(tokenize(chunk.docId.replaceAll("-", " "))),
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
      let matchedEntityTerms = 0;
      for (const term of terms) {
        const frequency = doc.termFreq.get(term);
        if (!frequency) continue;
        matchedTerms += 1;
        if (doc.entityTerms.has(term)) matchedEntityTerms += 1;
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
      if (score > 0)
        scored.push({
          chunk: doc.chunk,
          score,
          matchedTerms,
          matchedEntityTerms,
        });
    }

    const ranked = scored.sort(
      (a, b) =>
        b.score - a.score || a.chunk.sectionId.localeCompare(b.chunk.sectionId),
    );
    return capPerDocument(ranked, k);
  }
}

/**
 * At most MAX_CHUNKS_PER_DOC sections from any single document may fill the
 * top-k. Definitional/synthesis questions ("what does X mean") are answered
 * by evidence spanning several documents; without this, one long note floods
 * every slot and the model, given a single narrow source, refuses rather than
 * synthesises. The highest-scoring chunk (the confidence gate's input) is
 * always kept, so refusal behaviour is unchanged. Reduced 3 → 2 when the
 * corpus grew to 78 chunks: a single new note took three of five slots on a
 * synthesis question and the live model refused for lack of source diversity.
 */
export const MAX_CHUNKS_PER_DOC = 2;

function capPerDocument(ranked: ScoredChunk[], k: number): ScoredChunk[] {
  const perDoc = new Map<string, number>();
  const kept: ScoredChunk[] = [];
  for (const item of ranked) {
    if (kept.length >= k) break;
    const used = perDoc.get(item.chunk.docId) ?? 0;
    if (used >= MAX_CHUNKS_PER_DOC) continue;
    perDoc.set(item.chunk.docId, used + 1);
    kept.push(item);
  }
  return kept;
}

/**
 * Refusal gate (spec §11 step 6): retrieval confidence below this means the
 * agent refuses rather than improvises. A single shared word (e.g. "London"
 * in a weather question) must never count as confident, so the top result
 * needs BOTH a minimum score and at least two distinct matched query terms.
 *
 * Exception: definitional questions about a document's own subject ("What is
 * Foreman?") carry exactly one meaningful term after stopword removal. When
 * that term is a document-identity token AND the score clears a stricter
 * threshold, one term is enough. Body-text collisions ("London", "Python")
 * are not identity tokens and still refuse; weak identity hits ("What is
 * Claude?" ~3.7) sit below the stricter bar. Tuned against
 * tests/agent/retrieval-cases.json — change only with the fixtures
 * (retune history in docs/evaluation.md).
 */
export const CONFIDENCE_THRESHOLD = 1.5;
export const MIN_MATCHED_TERMS = 2;
export const ENTITY_CONFIDENCE_THRESHOLD = 3.95;

export function isConfident(results: ScoredChunk[]): boolean {
  const top = results[0];
  if (!top) return false;
  if (
    top.score >= CONFIDENCE_THRESHOLD &&
    top.matchedTerms >= MIN_MATCHED_TERMS
  ) {
    return true;
  }
  return (
    top.matchedEntityTerms >= 1 && top.score >= ENTITY_CONFIDENCE_THRESHOLD
  );
}
