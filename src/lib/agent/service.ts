/**
 * Agent orchestration (spec §11 request-time steps): validate → retrieve →
 * confidence gate → model → validate response → whitelist citations. Pure of
 * HTTP concerns so the Worker route and the integration tests drive the same
 * code. Structured events go through the injected logger; question text is
 * never logged (spec §14).
 */

import type { Corpus } from "../../../scripts/build-agent-corpus.ts";
import type { ModelAdapter } from "./adapter.ts";
import { buildUserMessage, REFUSAL_TEXT, SYSTEM_POLICY } from "./prompt.ts";
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

export type AgentOutcome =
  | {
      kind: "answered";
      answer: string;
      sources: { title: string; url: string }[];
    }
  | { kind: "refused"; answer: string }
  | { kind: "upstream_error" }
  | { kind: "upstream_rate_limited" };

const TOP_K = 5;

export class AgentService {
  private readonly retriever: Retriever;
  private readonly bySectionId: Map<string, { title: string; url: string }>;

  constructor(
    corpus: Corpus,
    private readonly adapter: ModelAdapter,
    private readonly log: AgentLogger,
  ) {
    this.retriever = new LexicalRetriever(corpus.chunks);
    this.bySectionId = new Map(
      corpus.chunks.map((chunk) => [
        chunk.sectionId,
        { title: chunk.title, url: chunk.url },
      ]),
    );
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
      user: buildUserMessage(results, question),
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

    const parsed = modelAnswerSchema.safeParse(result.raw);
    if (!parsed.success) {
      this.log({ event: "ask.response_invalid", requestId, durationMs });
      return { kind: "upstream_error" };
    }
    this.log({ event: "ask.provider_ok", requestId, durationMs });

    // Whitelist: only citations matching passages we actually supplied
    // survive (spec §11 step 10). The system prompt must never leak.
    const suppliedIds = new Set(results.map(({ chunk }) => chunk.sectionId));
    const validCitations = parsed.data.citations.filter((id) =>
      suppliedIds.has(id),
    );
    if (validCitations.length !== parsed.data.citations.length) {
      this.log({ event: "ask.citations_stripped", requestId });
    }

    if (
      parsed.data.answer.trim() === "" ||
      looksLikePolicyLeak(parsed.data.answer)
    ) {
      this.log({ event: "ask.response_invalid", requestId, durationMs });
      return { kind: "upstream_error" };
    }

    if (
      parsed.data.answer.includes(REFUSAL_TEXT) ||
      validCitations.length === 0
    ) {
      this.log({ event: "ask.refused_low_confidence", requestId });
      return { kind: "refused", answer: REFUSAL_TEXT };
    }

    const seen = new Set<string>();
    const sources = validCitations
      .map((id) => this.bySectionId.get(id))
      .filter((source): source is { title: string; url: string } =>
        Boolean(source),
      )
      .filter((source) => {
        if (seen.has(source.url)) return false;
        seen.add(source.url);
        return true;
      });

    this.log({
      event: "ask.answered",
      requestId,
      durationMs,
      sectionIds: validCitations,
    });
    return { kind: "answered", answer: parsed.data.answer, sources };
  }
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
