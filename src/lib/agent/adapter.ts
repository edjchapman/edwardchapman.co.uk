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

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResult>;
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
}
