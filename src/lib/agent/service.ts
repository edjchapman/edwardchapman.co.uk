/**
 * Agent orchestration (spec §11 request-time steps): validate → retrieve →
 * confidence gate → model → validate response → whitelist citations. Pure of
 * HTTP concerns so the Worker route and the integration tests drive the same
 * code. Structured events go through the injected logger; question text is
 * never logged (spec §14).
 */

import type { Corpus } from "../../../scripts/build-agent-corpus.ts";
import type { ModelAdapter, ModelCitation } from "./adapter.ts";
import { buildQuestionText, REFUSAL_TEXT, SYSTEM_POLICY } from "./prompt.ts";
import { LexicalRetriever, isConfident, type Retriever } from "./retrieval.ts";
import { modelAnswerSchema } from "./schema.ts";

export type AgentEvent = {
  event:
    | "ask.accepted"
    | "ask.refused_low_confidence"
    | "ask.provider_ok"
    | "ask.provider_timeout"
    | "ask.provider_rate_limited"
    | "ask.provider_error"
    | "ask.response_invalid"
    | "ask.citations_stripped"
    | "ask.answered"
    | "ask.unhandled_error";
  requestId: string;
  durationMs?: number;
  sectionIds?: string[];
  detail?: string;
};

export type AgentLogger = (event: AgentEvent) => void;

/** Half-open character span into the answer, pointing at a sources entry. */
export type CitationSpan = { start: number; end: number; sourceIndex: number };

export type AgentOutcome =
  | {
      kind: "answered";
      answer: string;
      citations: CitationSpan[];
      sources: { title: string; url: string }[];
    }
  | { kind: "refused"; answer: string }
  | { kind: "upstream_error" }
  | { kind: "upstream_rate_limited" };

const TOP_K = 5;

export class AgentService {
  private readonly retriever: Retriever;
  private readonly adapter: ModelAdapter;
  private readonly log: AgentLogger;

  constructor(corpus: Corpus, adapter: ModelAdapter, log: AgentLogger) {
    this.adapter = adapter;
    this.log = log;
    this.retriever = new LexicalRetriever(corpus.chunks);
  }

  async ask(question: string, requestId: string): Promise<AgentOutcome> {
    const started = Date.now();
    this.log({ event: "ask.accepted", requestId });

    const results = this.retriever.search(question, TOP_K);
    if (!isConfident(results)) {
      this.log({ event: "ask.refused_low_confidence", requestId });
      return { kind: "refused", answer: REFUSAL_TEXT };
    }

    const result = await this.adapter.complete({
      system: SYSTEM_POLICY,
      documents: results.map(({ chunk }) => ({
        sectionId: chunk.sectionId,
        title: chunk.title,
        url: chunk.url,
        text: chunk.text,
      })),
      question: buildQuestionText(question),
    });

    const durationMs = Date.now() - started;
    if (result.type === "timeout") {
      this.log({ event: "ask.provider_timeout", requestId, durationMs });
      return { kind: "upstream_error" };
    }
    if (result.type === "rate_limited") {
      this.log({ event: "ask.provider_rate_limited", requestId, durationMs });
      return { kind: "upstream_rate_limited" };
    }
    if (result.type === "provider_error") {
      this.log({
        event: "ask.provider_error",
        requestId,
        durationMs,
        detail: result.detail.slice(0, 120),
      });
      return { kind: "upstream_error" };
    }

    const parsed = modelAnswerSchema.safeParse(result.answer);
    if (!parsed.success) {
      this.log({ event: "ask.response_invalid", requestId, durationMs });
      return { kind: "upstream_error" };
    }
    this.log({ event: "ask.provider_ok", requestId, durationMs });

    // Whitelist (spec §11 step 10): only citations indexing passages we
    // actually supplied survive. The API enforces this upstream, so a strip
    // here is an anomaly signal, not routine hygiene (ADR-0012).
    const validCitations = parsed.data.citations.filter(
      (citation) => citation.documentIndex < results.length,
    );
    if (validCitations.length !== parsed.data.citations.length) {
      this.log({ event: "ask.citations_stripped", requestId });
    }

    if (
      parsed.data.text.trim() === "" ||
      looksLikePolicyLeak(parsed.data.text)
    ) {
      this.log({ event: "ask.response_invalid", requestId, durationMs });
      return { kind: "upstream_error" };
    }

    if (
      parsed.data.text.includes(REFUSAL_TEXT) ||
      validCitations.length === 0
    ) {
      this.log({ event: "ask.refused_low_confidence", requestId });
      return { kind: "refused", answer: REFUSAL_TEXT };
    }

    const mapped = mapCitationsToSources(
      validCitations,
      results.map(({ chunk }) => chunk),
    );

    this.log({
      event: "ask.answered",
      requestId,
      durationMs,
      sectionIds: mapped.citedSectionIds,
    });
    return {
      kind: "answered",
      answer: parsed.data.text,
      citations: mapped.citations,
      sources: mapped.sources,
    };
  }
}

/**
 * Resolve citation document indices into the public contract: sources
 * deduplicated by URL (two sections of one page share a number), ordered by
 * first citation appearance, with spans remapped onto that ordering.
 * Exported pure so the mapping rules are unit-testable without retrieval.
 */
export function mapCitationsToSources(
  citations: ModelCitation[],
  chunks: { sectionId: string; title: string; url: string }[],
): {
  citations: CitationSpan[];
  sources: { title: string; url: string }[];
  citedSectionIds: string[];
} {
  const ordered = [...citations].sort(
    (a, b) => a.start - b.start || a.documentIndex - b.documentIndex,
  );
  const sources: { title: string; url: string }[] = [];
  const indexByUrl = new Map<string, number>();
  const citedSectionIds: string[] = [];
  const spans: CitationSpan[] = [];

  for (const citation of ordered) {
    const chunk = chunks[citation.documentIndex];
    if (!chunk) continue; // whitelisted upstream; defensive
    let sourceIndex = indexByUrl.get(chunk.url);
    if (sourceIndex === undefined) {
      sourceIndex = sources.length;
      indexByUrl.set(chunk.url, sourceIndex);
      sources.push({ title: chunk.title, url: chunk.url });
    }
    spans.push({ start: citation.start, end: citation.end, sourceIndex });
    if (!citedSectionIds.includes(chunk.sectionId)) {
      citedSectionIds.push(chunk.sectionId);
    }
  }
  return { citations: spans, sources, citedSectionIds };
}

function looksLikePolicyLeak(answer: string): boolean {
  const fingerprints = [
    'the "ask" assistant on edwardchapman.co.uk',
    "Rules, in priority order",
    "system policy",
  ];
  return fingerprints.some((fingerprint) =>
    answer.toLowerCase().includes(fingerprint.toLowerCase()),
  );
}
