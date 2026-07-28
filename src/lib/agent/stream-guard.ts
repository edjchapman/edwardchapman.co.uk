/**
 * The streaming output-control guard (ADR-0016). It enforces, incrementally
 * over an adapter event stream, the same spec §10 invariants the buffered path
 * validates on the whole answer:
 *
 * - Grounding buffer: withhold all text until the first whitelisted citation
 *   proves grounding. Zero citations at stream end ⇒ refuse — nothing was ever
 *   revealed, so an ungrounded answer cannot reach the client.
 * - Leak scan with tail hold-back: never emit within MAX_FINGERPRINT_LENGTH of
 *   the buffer end, and abort if a policy fingerprint appears, so a phrase
 *   straddling a delta boundary is caught before its final character ships.
 *
 * Pure and provider-agnostic: it consumes ModelStreamEvents and returns the
 * text safe to emit now plus an optional terminal verdict. Source mapping and
 * the pre-model confidence gate stay in the service.
 */

import type { ModelCitation, ModelStreamEvent } from "./adapter.ts";
import { looksLikePolicyLeak, MAX_FINGERPRINT_LENGTH } from "./policy-leak.ts";
import { REFUSAL_TEXT } from "./prompt.ts";

export type StreamTerminal =
  | { type: "answered" }
  | { type: "refused"; reason: "model_declined" | "no_citations" }
  // Transient failure, tagged with its cause so the service logs it with
  // parity to the buffered path (ADR-0026): `timeout` and `provider` come
  // from the adapter (the latter carries its detail), `invalid_output` is a
  // guard-detected empty answer or policy leak.
  | {
      type: "error";
      cause: "timeout" | "provider" | "invalid_output";
      detail?: string;
    }
  // Non-retryable provider rejection surfaced mid-stream (ADR-0026).
  | { type: "unavailable"; detail: string }
  | { type: "rate_limited" };

export type GuardStep = { emit: string[]; done?: StreamTerminal };

export class StreamGuard {
  private full = "";
  private emitted = 0;
  private grounded = false;
  private readonly documentCount: number;
  readonly validCitations: ModelCitation[] = [];

  constructor(documentCount: number) {
    this.documentCount = documentCount;
  }

  /** Feed one adapter event; get the text to emit now and any terminal verdict. */
  consume(event: ModelStreamEvent): GuardStep {
    switch (event.type) {
      case "text":
        this.full += event.delta;
        return this.drainGuarded();
      case "citation":
        return this.acceptCitation(event.citation);
      case "completed":
        return this.finish();
      case "rate_limited":
        return { emit: [], done: { type: "rate_limited" } };
      case "timeout":
        return { emit: [], done: { type: "error", cause: "timeout" } };
      case "provider_error":
        return {
          emit: [],
          done: { type: "error", cause: "provider", detail: event.detail },
        };
      case "provider_unavailable":
        return {
          emit: [],
          done: { type: "unavailable", detail: event.detail },
        };
    }
  }

  private acceptCitation(citation: ModelCitation): GuardStep {
    // Whitelist (ADR-0012): a citation indexing a passage we never supplied is
    // an anomaly and does not count toward grounding.
    if (citation.documentIndex >= this.documentCount) return { emit: [] };
    this.validCitations.push(citation);
    if (this.grounded) return { emit: [] };
    this.grounded = true; // first grounded citation — release the buffer
    return this.drainGuarded();
  }

  private drainGuarded(): GuardStep {
    if (!this.grounded) return { emit: [] }; // grounding buffer still closed
    if (looksLikePolicyLeak(this.full))
      return { emit: [], done: { type: "error", cause: "invalid_output" } };
    if (this.full.includes(REFUSAL_TEXT)) return { emit: [] }; // finish() refuses
    return { emit: this.drain(this.full.length - MAX_FINGERPRINT_LENGTH) };
  }

  private drain(cap: number): string[] {
    const bounded = Math.min(Math.max(cap, this.emitted), this.full.length);
    if (bounded <= this.emitted) return [];
    const slice = this.full.slice(this.emitted, bounded);
    this.emitted = bounded;
    return [slice];
  }

  private finish(): GuardStep {
    if (this.full.trim() === "" || looksLikePolicyLeak(this.full)) {
      return { emit: [], done: { type: "error", cause: "invalid_output" } };
    }
    if (this.full.includes(REFUSAL_TEXT)) {
      return { emit: [], done: { type: "refused", reason: "model_declined" } };
    }
    if (this.validCitations.length === 0) {
      return { emit: [], done: { type: "refused", reason: "no_citations" } };
    }
    return { emit: this.drain(this.full.length), done: { type: "answered" } };
  }
}
