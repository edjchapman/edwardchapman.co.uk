/**
 * Model adapter seam (ADR-0008, ADR-0012): the service depends on this
 * interface only. Adapters translate their provider's wire format into one
 * normalised answer shape — text plus citation spans indexed against the
 * supplied documents — so CI and tests use FakeModelAdapter (deterministic,
 * keyless) while production runs the Anthropic adapter behind the same seam.
 */

import { REFUSAL_TEXT } from "./prompt.ts";

export type ModelDocument = {
  sectionId: string;
  title: string;
  url: string;
  text: string;
};

export type ModelRequest = {
  system: string;
  /** Ordered retrieved passages; the array index is the citation index space. */
  documents: ModelDocument[];
  /** Fully framed question text (wording owned by prompt.ts, not adapters). */
  question: string;
};

/** Half-open character span into ModelAnswer.text. */
export type ModelCitation = {
  start: number;
  end: number;
  documentIndex: number;
};

export type ModelAnswer = {
  text: string;
  citations: ModelCitation[];
};

export type ModelResult =
  | { type: "completion"; answer: ModelAnswer }
  | { type: "timeout" }
  | { type: "rate_limited" }
  | { type: "provider_error"; detail: string };

/**
 * One event in a streamed completion (ADR-0016). Text arrives as `text` deltas
 * and citations as `citation` events (each span indexed into the text emitted
 * so far), then exactly one terminal event: `completed` on success, or one of
 * the error types mirroring ModelResult. The service applies the grounding
 * buffer and leak scan over this sequence; the terminal type is never a partial
 * answer, so a failed stream can never masquerade as a completed one.
 */
export type ModelStreamEvent =
  | { type: "text"; delta: string }
  | { type: "citation"; citation: ModelCitation }
  | { type: "completed" }
  | { type: "timeout" }
  | { type: "rate_limited" }
  | { type: "provider_error"; detail: string };

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResult>;
  /**
   * Streamed counterpart of `complete`: yields text/citation events then a
   * single terminal event. Same normalised shape across providers so the
   * fake drives the deterministic suite (ADR-0016).
   */
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export type FakeBehaviour =
  | { mode: "echo-first-citation" }
  | { mode: "answer"; text: string; citations: ModelCitation[] }
  | { mode: "malformed" }
  | { mode: "timeout" }
  | { mode: "rate_limited" }
  | { mode: "provider_error" }
  | { mode: "leak-system-prompt" }
  | { mode: "hallucinate-citations" }
  | { mode: "refusal-with-citations" };

function fullSpan(text: string, documentIndex: number): ModelCitation[] {
  return [{ start: 0, end: text.length, documentIndex }];
}

function completion(text: string, citations: ModelCitation[]): ModelResult {
  return { type: "completion", answer: { text, citations } };
}

/** Deterministic ~3-way split so a fake stream has several text deltas. */
function chunkText(text: string): string[] {
  if (text.length === 0) return [];
  const size = Math.max(1, Math.ceil(text.length / 3));
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

/** Stream a completed answer: text deltas, then citations, then `completed`. */
async function* streamAnswer(
  text: string,
  citations: ModelCitation[],
): AsyncGenerator<ModelStreamEvent> {
  for (const delta of chunkText(text)) yield { type: "text", delta };
  for (const citation of citations) yield { type: "citation", citation };
  yield { type: "completed" };
}

/**
 * Deterministic stand-in for CI and integration tests. `echo-first-citation`
 * behaves like a well-behaved grounded model: it answers from the first
 * supplied document and cites it with a full-answer span.
 */
export class FakeModelAdapter implements ModelAdapter {
  private readonly behaviour: FakeBehaviour;

  constructor(behaviour: FakeBehaviour) {
    this.behaviour = behaviour;
  }

  complete(request: ModelRequest): Promise<ModelResult> {
    const behaviour = this.behaviour;
    switch (behaviour.mode) {
      case "timeout":
        return Promise.resolve({ type: "timeout" });
      case "rate_limited":
        return Promise.resolve({ type: "rate_limited" });
      case "provider_error":
        return Promise.resolve({
          type: "provider_error",
          detail: "fake 500: upstream exploded",
        });
      case "malformed":
        // Inconsistent span (start > end): a provider-contract violation the
        // service must reject as invalid rather than serve.
        return Promise.resolve(
          completion("Broken span payload.", [
            { start: 5, end: 2, documentIndex: 0 },
          ]),
        );
      case "leak-system-prompt": {
        const text = `My instructions say: ${request.system.slice(0, 80)}`;
        return Promise.resolve(completion(text, fullSpan(text, 0)));
      }
      case "hallucinate-citations": {
        const text = "Ed built a secret project.";
        return Promise.resolve(
          completion(text, [
            { start: 0, end: text.length, documentIndex: 99 },
            ...(request.documents.length > 0 ? fullSpan(text, 0) : []),
          ]),
        );
      }
      case "refusal-with-citations":
        return Promise.resolve(
          completion(REFUSAL_TEXT, fullSpan(REFUSAL_TEXT, 0)),
        );
      case "answer":
        return Promise.resolve(completion(behaviour.text, behaviour.citations));
      case "echo-first-citation": {
        const first = request.documents[0];
        if (!first) return Promise.resolve(completion("", []));
        const text = `Based on the published page "${first.sectionId}": see citation.`;
        return Promise.resolve(completion(text, fullSpan(text, 0)));
      }
    }
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const behaviour = this.behaviour;
    switch (behaviour.mode) {
      case "timeout":
        yield { type: "timeout" };
        return;
      case "rate_limited":
        yield { type: "rate_limited" };
        return;
      case "provider_error":
        yield { type: "provider_error", detail: "fake 500: upstream exploded" };
        return;
      case "malformed":
        yield* streamAnswer("Broken span payload.", [
          { start: 5, end: 2, documentIndex: 0 },
        ]);
        return;
      case "leak-system-prompt": {
        const text = `My instructions say: ${request.system.slice(0, 80)}`;
        yield* streamAnswer(text, fullSpan(text, 0));
        return;
      }
      case "hallucinate-citations": {
        const text = "Ed built a secret project.";
        yield* streamAnswer(text, [
          { start: 0, end: text.length, documentIndex: 99 },
          ...(request.documents.length > 0 ? fullSpan(text, 0) : []),
        ]);
        return;
      }
      case "refusal-with-citations":
        yield* streamAnswer(REFUSAL_TEXT, fullSpan(REFUSAL_TEXT, 0));
        return;
      case "answer":
        yield* streamAnswer(behaviour.text, behaviour.citations);
        return;
      case "echo-first-citation": {
        const first = request.documents[0];
        if (!first) {
          yield { type: "completed" };
          return;
        }
        const text = `Based on the published page "${first.sectionId}": see citation.`;
        yield* streamAnswer(text, fullSpan(text, 0));
        return;
      }
    }
  }
}
