/**
 * Pure stream/response helpers for the AskForm island, extracted so the
 * component stays under the file-size cap and the wire-protocol logic is
 * unit-reasonable on its own. No React, no side effects.
 *
 * The error phase carries `offline` (ADR-0026): the non-retryable
 * `upstream_unavailable` class renders distinct copy plus a pointer to the
 * published pages, rather than inviting a retry that cannot succeed.
 */

import {
  RATE_LIMITED_MESSAGE,
  UPSTREAM_ERROR_MESSAGE,
  UPSTREAM_UNAVAILABLE_MESSAGE,
} from "../lib/agent/ask-copy.ts";
import { type Exchange, type Source } from "./AskExchange.tsx";
import { type CitationSpan } from "./ask-citations.ts";

export type AskState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "streaming"; answer: string }
  | { phase: "answered"; exchange: Exchange }
  | { phase: "error"; message: string; offline: boolean };

/** The wire events the streaming route emits (ADR-0016, ADR-0026). */
export type StreamEvent =
  | { kind: "answer_delta"; text: string }
  | { kind: "answered"; citations?: CitationSpan[]; sources?: Source[] }
  | { kind: "refused"; answer: string }
  | { kind: "upstream_error" }
  | { kind: "upstream_unavailable" }
  | { kind: "upstream_rate_limited" };

/** Shown when the fetch itself fails, or a stream dies before any answer. */
export const NETWORK_ERROR_MESSAGE =
  "The request didn't complete — please try again.";

/** Last-resort copy when the server sends an error envelope we can't read. */
export const GENERIC_ERROR_MESSAGE =
  "Something went wrong — please try again shortly.";

/** A transient error state (retry may help); the default for unknown failures. */
export const transientError = (): AskState => ({
  phase: "error",
  message: UPSTREAM_ERROR_MESSAGE,
  offline: false,
});

export function parseStreamEvent(block: string): StreamEvent | null {
  const line = block.split("\n").find((entry) => entry.startsWith("data:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(":") + 1)) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * Extract the visitor message and machine code from a non-OK JSON envelope.
 * The code drives whether the client renders the distinct offline state.
 */
export async function errorMessage(
  response: Response,
): Promise<{ message: string; code: string | null }> {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: { message?: unknown; code?: unknown } })
      .error;
    const message =
      typeof error?.message === "string"
        ? error.message
        : GENERIC_ERROR_MESSAGE;
    const code = typeof error?.code === "string" ? error.code : null;
    return { message, code };
  } catch {
    // non-JSON body — fall through to the generic message
    return { message: GENERIC_ERROR_MESSAGE, code: null };
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Map a terminal stream event to its finished state; null for deltas. An
 * unknown `kind` (a newer server than this cached client) also returns null —
 * the caller maps that to the transient error, never a silent idle.
 */
export function terminalState(
  event: StreamEvent,
  answer: string,
  asked: string,
): AskState | null {
  switch (event.kind) {
    case "answer_delta":
      return null;
    case "answered":
      return {
        phase: "answered",
        exchange: {
          question: asked,
          answer,
          citations: event.citations ?? [],
          sources: event.sources ?? [],
          refused: false,
          stopped: false,
          baseline: false,
        },
      };
    case "refused":
      return {
        phase: "answered",
        exchange: {
          question: asked,
          answer: event.answer,
          citations: [],
          sources: [],
          refused: true,
          stopped: false,
          baseline: false,
        },
      };
    case "upstream_rate_limited":
      return { phase: "error", message: RATE_LIMITED_MESSAGE, offline: false };
    case "upstream_unavailable":
      return {
        phase: "error",
        message: UPSTREAM_UNAVAILABLE_MESSAGE,
        offline: true,
      };
    case "upstream_error":
      return {
        phase: "error",
        message: UPSTREAM_ERROR_MESSAGE,
        offline: false,
      };
    default:
      // Unknown terminal kind from a newer deploy: fail to the transient
      // error, never a quiet idle that leaves the form looking hung.
      return null;
  }
}
