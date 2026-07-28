/**
 * Live model adapter (Phase 4): Anthropic Messages API through the official
 * TypeScript SDK (Workers-compatible), behind the same ModelAdapter seam the
 * fake implements (ADR-0008). Retrieved passages travel as search_result
 * blocks with citations enabled, so citations are attached by the API to
 * spans of the answer rather than claimed by the model (ADR-0012); provider
 * failures map onto the adapter's error taxonomy so the service layer stays
 * provider-agnostic.
 *
 * The base URL is configurable so calls can route through Cloudflare AI
 * Gateway (spec §2, "where practical") without a code change.
 */

import Anthropic from "@anthropic-ai/sdk";

import { REFUSAL_TEXT } from "./refusal.ts";

import type {
  ModelAdapter,
  ModelCitation,
  ModelRequest,
  ModelResult,
  ModelStreamEvent,
} from "./adapter.ts";

export type AnthropicAdapterConfig = {
  apiKey: string;
  /** Config-driven model id (spec §2): the ANTHROPIC_MODEL binding. */
  model: string;
  /** Optional AI Gateway endpoint; defaults to the Anthropic API. */
  baseURL?: string | undefined;
  /**
   * Test seam: stubs the transport while the real SDK still performs request
   * serialisation and error classification. Production never sets it.
   */
  fetch?: typeof globalThis.fetch | undefined;
};

const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 1024;
/**
 * Pinned low for a grounded factual assistant: the Citations API constrains
 * *what* can be claimed, but not run-to-run phrasing variance — and the live
 * eval judges phrasing (required claims). Not 0: a little headroom keeps
 * refusal wording and multi-block assembly from degenerating on ties.
 */
const TEMPERATURE = 0.2;

export class AnthropicAdapter implements ModelAdapter {
  private readonly client: Anthropic;
  private readonly model: string;

  // Explicit field + body assignment, not a `private` parameter property:
  // this module is imported by scripts/run-agent-evals.ts, which Node runs
  // through erasable-only type-stripping — parameter properties emit an
  // assignment and are rejected there (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  constructor(config: AnthropicAdapterConfig) {
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: request.system,
        messages: [{ role: "user", content: buildContent(request) }],
      });
      return parseCompletion(message);
    } catch (error) {
      return mapProviderError(error);
    }
  }

  /**
   * Streamed counterpart (ADR-0016). Text deltas and citation events emerge as
   * the API generates them; citation spans are computed against the text seen
   * so far, mirroring parseCompletion's block-to-span mapping. A terminal event
   * always closes the sequence — `completed`, or an error mapped through the
   * same taxonomy as `complete`. The grounding buffer and leak scan that guard
   * output live in the service, over this event stream.
   */
  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    let text = "";
    let blockStart = 0;
    // The streaming API announces a text block's citations BEFORE its text
    // arrives, so a citation's answer-span is unknown when it lands. Collect
    // each block's cited document indices, then resolve them against the
    // block's full text range at content_block_stop (mirrors parseCompletion).
    let blockCitations: number[] = [];
    try {
      const stream = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: request.system,
        messages: [{ role: "user", content: buildContent(request) }],
        stream: true,
      });
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          blockStart = text.length;
          blockCitations = [];
        } else if (event.type === "content_block_delta") {
          const { delta } = event;
          if (delta.type === "text_delta") {
            text += delta.text;
            if (delta.text) yield { type: "text", delta: delta.text };
          } else if (
            delta.type === "citations_delta" &&
            delta.citation.type === "search_result_location"
          ) {
            blockCitations.push(delta.citation.search_result_index);
          }
        } else if (event.type === "content_block_stop") {
          const span = trimSpan(text, blockStart, text.length);
          if (span) {
            for (const documentIndex of blockCitations) {
              yield { type: "citation", citation: { ...span, documentIndex } };
            }
          }
        }
      }
    } catch (error) {
      const mapped = mapProviderError(error);
      // mapProviderError never returns a completion; the guard satisfies the
      // type and, defensively, keeps a stray completion out of the error path.
      yield mapped.type === "completion"
        ? { type: "provider_error", detail: "unexpected adapter failure" }
        : mapped;
      return;
    }
    if (text.trim() === "") {
      // Same semantics as parseCompletion's empty case: an API-level
      // refusal. Emit the canonical sentence so the stream guard and
      // service route it as model_declined rather than a 502.
      yield { type: "text", delta: REFUSAL_TEXT };
      yield { type: "completed" };
      return;
    }
    yield { type: "completed" };
  }
}

/**
 * Evidence and question travel as typed blocks: one search_result per
 * retrieved passage (citations enabled on every block — the API requires
 * all-or-none), then the framed question as a plain text block.
 */
function buildContent(request: ModelRequest): Anthropic.ContentBlockParam[] {
  return [
    ...request.documents.map((doc): Anthropic.SearchResultBlockParam => ({
      type: "search_result",
      source: doc.url,
      title: doc.title,
      content: [{ type: "text", text: doc.text }],
      citations: { enabled: true },
    })),
    { type: "text", text: request.question },
  ];
}

/**
 * The answer is the concatenation of the response's text blocks; a block
 * carrying citations is a grounded span of that answer. `search_result_index`
 * counts the request's search_result blocks in order — exactly the documents
 * array, since the request has a single user message.
 */
function parseCompletion(message: Anthropic.Message): ModelResult {
  let text = "";
  const citations: ModelCitation[] = [];
  for (const block of message.content) {
    if (block.type !== "text") continue;
    const blockStart = text.length;
    text += block.text;
    for (const citation of block.citations ?? []) {
      if (citation.type !== "search_result_location") continue;
      const span = trimSpan(text, blockStart, text.length);
      if (span) {
        citations.push({
          ...span,
          documentIndex: citation.search_result_index,
        });
      }
    }
  }
  if (text.trim() === "") {
    return declinedCompletion();
  }
  return { type: "completion", answer: { text, citations } };
}

/**
 * An empty completion is the API declining to answer (the provider-level
 * refusal classifier returns no content — observed live on impersonation
 * probes). That is a refusal, not an outage: surface the canonical
 * sentence so the service routes it through its model_declined path and
 * the visitor gets the graceful refusal envelope, never a 502.
 */
function declinedCompletion(): ModelResult {
  return {
    type: "completion",
    answer: { text: REFUSAL_TEXT, citations: [] },
  };
}

/** Shrink a span past leading/trailing whitespace; null when nothing remains. */
function trimSpan(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from] ?? "")) from += 1;
  while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
  return from < to ? { start: from, end: to } : null;
}

function mapProviderError(error: unknown): ModelResult {
  if (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return { type: "timeout" };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { type: "rate_limited" };
  }
  if (error instanceof Anthropic.APIError) {
    // Status + API error type only — content-free, safe for logs and eval
    // reports, and enough to tell the class apart. Classify by status, never
    // by message (ADR-0026): 4xx here (429 already peeled above) is a
    // non-retryable rejection the operator must act on — billing 400, dead
    // key 401, forbidden 403, retired model 404. Everything else (5xx, or a
    // missing status) is transient.
    const detail = `status ${String(error.status)} ${error.type ?? ""}`.trim();
    const status = error.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { type: "provider_unavailable", detail };
    }
    return { type: "provider_error", detail };
  }
  return { type: "provider_error", detail: "unexpected adapter failure" };
}
