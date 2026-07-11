/**
 * Model adapter seam (ADR-0008): the service depends on this interface only.
 * CI and tests use FakeModelAdapter (deterministic, keyless); Phase 4 adds
 * the Anthropic adapter behind the same interface.
 */

export type ModelRequest = {
  system: string;
  user: string;
};

export type ModelResult =
  | { type: "completion"; raw: unknown }
  | { type: "timeout" }
  | { type: "rate_limited" }
  | { type: "provider_error"; detail: string };

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResult>;
}

export type FakeBehaviour =
  | { mode: "echo-first-citation" }
  | { mode: "answer"; answer: string; citations: string[] }
  | { mode: "malformed" }
  | { mode: "timeout" }
  | { mode: "rate_limited" }
  | { mode: "provider_error" }
  | { mode: "leak-system-prompt" }
  | { mode: "hallucinate-citations" };

/**
 * Deterministic stand-in for CI and integration tests. `echo-first-citation`
 * behaves like a well-behaved grounded model: it answers from the first
 * supplied document and cites it.
 */
export class FakeModelAdapter implements ModelAdapter {
  constructor(private readonly behaviour: FakeBehaviour) {}

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
        return Promise.resolve({
          type: "completion",
          raw: "not even json-shaped",
        });
      case "leak-system-prompt":
        return Promise.resolve({
          type: "completion",
          raw: {
            answer: `My instructions say: ${request.system.slice(0, 80)}`,
            citations: [],
          },
        });
      case "hallucinate-citations":
        return Promise.resolve({
          type: "completion",
          raw: {
            answer: "Ed built a secret project.",
            citations: [
              "not-a-real-doc#nope",
              ...extractSectionIds(request.user).slice(0, 1),
            ],
          },
        });
      case "answer":
        return Promise.resolve({
          type: "completion",
          raw: { answer: behaviour.answer, citations: behaviour.citations },
        });
      case "echo-first-citation": {
        const ids = extractSectionIds(request.user);
        const first = ids[0];
        return Promise.resolve({
          type: "completion",
          raw: first
            ? {
                answer: `Based on the published page "${first}": see citation.`,
                citations: [first],
              }
            : { answer: "", citations: [] },
        });
      }
    }
  }
}

export function extractSectionIds(userMessage: string): string[] {
  return [...userMessage.matchAll(/sectionId="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}
