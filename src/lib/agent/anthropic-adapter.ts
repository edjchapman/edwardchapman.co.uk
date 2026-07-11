/**
 * Live model adapter (Phase 4): Anthropic Messages API through the official
 * TypeScript SDK (Workers-compatible), behind the same ModelAdapter seam the
 * fake implements (ADR-0008). Structured outputs constrain the response to
 * the answer+citations schema; provider failures map onto the adapter's
 * error taxonomy so the service layer stays provider-agnostic.
 *
 * The base URL is configurable so calls can route through Cloudflare AI
 * Gateway (spec §2, "where practical") without a code change.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { ModelAdapter, ModelRequest, ModelResult } from "./adapter.ts";
import { MODEL_ANSWER_JSON_SCHEMA } from "./schema.ts";

export type AnthropicAdapterConfig = {
  apiKey: string;
  /** Config-driven model id (spec §2): the ANTHROPIC_MODEL binding. */
  model: string;
  /** Optional AI Gateway endpoint; defaults to the Anthropic API. */
  baseURL?: string | undefined;
};

const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 1024;

export class AnthropicAdapter implements ModelAdapter {
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicAdapterConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    try {
      const message = await this.client.messages.create({
        model: this.config.model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: {
          format: {
            type: "json_schema",
            schema: MODEL_ANSWER_JSON_SCHEMA,
          },
        },
      });

      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) {
        return { type: "provider_error", detail: "empty completion" };
      }
      try {
        return { type: "completion", raw: JSON.parse(text) };
      } catch {
        // Hand the raw text to the service's schema validation, which will
        // reject it as malformed without exposing provider detail.
        return { type: "completion", raw: text };
      }
    } catch (error) {
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
        return {
          type: "provider_error",
          detail: `status ${String(error.status)}`,
        };
      }
      return { type: "provider_error", detail: "unexpected adapter failure" };
    }
  }
}
