/**
 * Agent orchestration (spec §11 request-time steps): validate → retrieve →
 * confidence gate → model → validate response → whitelist citations. Pure of
 * HTTP concerns so the Worker route and the integration tests drive the same
 * code. Structured events go through the injected logger; the accepted event
 * records the question for abuse monitoring (ADR-0023) and answers are never
 * logged.
 */

import type {
  Corpus,
  CorpusChunk,
} from "../../../scripts/build-agent-corpus.ts";
import type { ModelAdapter, ModelCitation, ModelRequest } from "./adapter.ts";
import { looksLikePolicyLeak } from "./policy-leak.ts";
import { buildQuestionText, REFUSAL_TEXT, SYSTEM_POLICY } from "./prompt.ts";
import { LexicalRetriever, isConfident, type Retriever } from "./retrieval.ts";
import { modelAnswerSchema } from "./schema.ts";
import { StreamGuard, type StreamTerminal } from "./stream-guard.ts";

export type AgentEvent = {
  event:
    | "ask.accepted"
    | "ask.refused_low_confidence"
    | "ask.refused_model_declined"
    | "ask.refused_no_citations"
    | "ask.provider_ok"
    | "ask.provider_timeout"
    | "ask.provider_rate_limited"
    | "ask.provider_error"
    | "ask.quota_exceeded"
    | "ask.quota_skipped"
    | "ask.response_invalid"
    | "ask.citations_stripped"
    | "ask.answered"
    | "ask.unhandled_error";
  requestId: string;
  durationMs?: number;
  sectionIds?: string[];
  detail?: string;
  /** The visitor's question, carried on `ask.accepted` only (ADR-0023):
   * recorded for abuse monitoring, bounded by the 500-char validation and
   * defensively truncated here; answers are never logged. */
  question?: string;
};

/** Matches MAX_QUESTION_LENGTH upstream; a defensive bound for callers that
 * bypass route validation (tests, probes). */
const LOGGED_QUESTION_LIMIT = 500;

export type AgentLogger = (event: AgentEvent) => void;

/** Half-open character span into the answer, pointing at a sources entry. */
export type CitationSpan = { start: number; end: number; sourceIndex: number };

/**
 * Why a question was refused. Content-free (no answer text) so it is safe to
 * log and surface in eval reports: `low_confidence` = retrieval gate;
 * `model_declined` = the model returned the refusal sentence; `no_citations` =
 * the model answered but nothing cited a supplied passage.
 */
export type RefusalReason =
  "low_confidence" | "model_declined" | "no_citations";

export type AgentOutcome =
  | {
      kind: "answered";
      answer: string;
      citations: CitationSpan[];
      sources: { title: string; url: string }[];
    }
  | { kind: "refused"; answer: string; reason: RefusalReason }
  | { kind: "upstream_error" }
  | { kind: "upstream_rate_limited" };

/**
 * One event in a streamed answer (ADR-0016). `answer_delta`s carry validated,
 * grounded text — never emitted before the first whitelisted citation proves
 * grounding, never carrying a policy-leak fingerprint. Exactly one terminal
 * event closes the stream: `answered` carries the final citation spans and
 * sources for the text already delta'd; the others mirror AgentOutcome.
 */
export type AgentStreamEvent =
  | { kind: "answer_delta"; text: string }
  | {
      kind: "answered";
      citations: CitationSpan[];
      sources: { title: string; url: string }[];
    }
  | { kind: "refused"; answer: string; reason: RefusalReason }
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
    this.log({
      event: "ask.accepted",
      requestId,
      question: question.slice(0, LOGGED_QUESTION_LIMIT),
    });

    const results = this.retriever.search(question, TOP_K);
    if (!isConfident(results)) {
      this.log({ event: "ask.refused_low_confidence", requestId });
      return {
        kind: "refused",
        answer: REFUSAL_TEXT,
        reason: "low_confidence",
      };
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

    // Two distinct refusal causes, kept separate so the reason is observable
    // (content-free) rather than collapsed: the model itself declined, versus
    // the model answered but nothing cited a supplied passage.
    if (parsed.data.text.includes(REFUSAL_TEXT)) {
      this.log({ event: "ask.refused_model_declined", requestId });
      return {
        kind: "refused",
        answer: REFUSAL_TEXT,
        reason: "model_declined",
      };
    }
    if (validCitations.length === 0) {
      this.log({ event: "ask.refused_no_citations", requestId });
      return { kind: "refused", answer: REFUSAL_TEXT, reason: "no_citations" };
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

  /**
   * Streamed counterpart of `ask` (ADR-0016). The confidence gate still refuses
   * pre-model — a low-confidence question never opens a model stream. Otherwise
   * a StreamGuard enforces the output controls incrementally over the adapter's
   * events (grounding buffer + leak scan); text arrives as `answer_delta`s and
   * a single terminal event carries the final citations/sources or a refusal.
   */
  async *askStream(
    question: string,
    requestId: string,
  ): AsyncGenerator<AgentStreamEvent> {
    this.log({
      event: "ask.accepted",
      requestId,
      question: question.slice(0, LOGGED_QUESTION_LIMIT),
    });
    const results = this.retriever.search(question, TOP_K);
    if (!isConfident(results)) {
      this.log({ event: "ask.refused_low_confidence", requestId });
      yield { kind: "refused", answer: REFUSAL_TEXT, reason: "low_confidence" };
      return;
    }

    const chunks = results.map(({ chunk }) => chunk);
    const guard = new StreamGuard(chunks.length);
    const request: ModelRequest = {
      system: SYSTEM_POLICY,
      documents: chunks.map((chunk) => ({
        sectionId: chunk.sectionId,
        title: chunk.title,
        url: chunk.url,
        text: chunk.text,
      })),
      question: buildQuestionText(question),
    };

    let terminal: StreamTerminal | undefined;
    try {
      for await (const event of this.adapter.stream(request)) {
        const { emit, done } = guard.consume(event);
        for (const text of emit) yield { kind: "answer_delta", text };
        if (done) {
          terminal = done;
          break;
        }
      }
    } catch {
      this.log({ event: "ask.unhandled_error", requestId });
      yield { kind: "upstream_error" };
      return;
    }

    yield* this.streamTerminal(terminal, guard, chunks, requestId);
  }

  private *streamTerminal(
    terminal: StreamTerminal | undefined,
    guard: StreamGuard,
    chunks: CorpusChunk[],
    requestId: string,
  ): Generator<AgentStreamEvent> {
    if (!terminal || terminal.type === "error") {
      this.log({ event: "ask.provider_error", requestId });
      yield { kind: "upstream_error" };
      return;
    }
    if (terminal.type === "rate_limited") {
      this.log({ event: "ask.provider_rate_limited", requestId });
      yield { kind: "upstream_rate_limited" };
      return;
    }
    if (terminal.type === "refused") {
      this.log({
        event:
          terminal.reason === "model_declined"
            ? "ask.refused_model_declined"
            : "ask.refused_no_citations",
        requestId,
      });
      yield { kind: "refused", answer: REFUSAL_TEXT, reason: terminal.reason };
      return;
    }
    const mapped = mapCitationsToSources(guard.validCitations, chunks);
    this.log({
      event: "ask.answered",
      requestId,
      sectionIds: mapped.citedSectionIds,
    });
    yield {
      kind: "answered",
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
