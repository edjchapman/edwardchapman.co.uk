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

import type {
  ModelAdapter,
  ModelCitation,
  ModelRequest,
  ModelResult,
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
        system: request.system,
        messages: [{ role: "user", content: buildContent(request) }],
      });
      return parseCompletion(message);
    } catch (error) {
      return mapProviderError(error);
    }
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
    return { type: "provider_error", detail: "empty completion" };
  }
  return { type: "completion", answer: { text, citations } };
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
    // reports, and enough to tell a rejected request shape (400) from an
    // auth or capacity failure.
    return {
      type: "provider_error",
      detail: `status ${String(error.status)} ${error.type ?? ""}`.trim(),
    };
  }
  return { type: "provider_error", detail: "unexpected adapter failure" };
}
