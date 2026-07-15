import type { APIRoute } from "astro";

import corpusJson from "../../generated/corpus.json";
import type { Corpus } from "../../../scripts/build-agent-corpus.ts";
import {
  FakeModelAdapter,
  type ModelAdapter,
} from "../../lib/agent/adapter.ts";
import { AnthropicAdapter } from "../../lib/agent/anthropic-adapter.ts";
import { askRequestSchema, MAX_BODY_BYTES } from "../../lib/agent/schema.ts";
import {
  AgentService,
  type AgentLogger,
  type AgentStreamEvent,
} from "../../lib/agent/service.ts";

export const prerender = false;

const CANONICAL_HOST = "edwardchapman.co.uk";

type ErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "rate_limited"
  | "not_found"
  | "upstream_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  method_not_allowed: 405,
  rate_limited: 429,
  not_found: 404,
  upstream_error: 502,
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: 'Send JSON like {"question": "…"} — up to 500 characters.',
  method_not_allowed: "Use POST with a JSON body.",
  rate_limited: "Too many questions right now — please try again in a minute.",
  not_found: "Not found.",
  upstream_error:
    "The answer service had a problem. Nothing you did — try again shortly.",
};

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AskEnv {
  ASK_RATE_LIMITER?: RateLimitBinding;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
}

const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function errorResponse(code: ErrorCode, requestId: string): Response {
  return new Response(
    JSON.stringify({
      error: { code, message: ERROR_MESSAGE[code] },
      requestId,
    }),
    { status: ERROR_STATUS[code], headers: jsonHeaders },
  );
}

const structuredLog: AgentLogger = (event) => {
  // Structured, redacted events only — never question or answer text.
  console.log(JSON.stringify(event));
};

/**
 * Server-Sent-Events stream of the validated answer (ADR-0016). Each line is
 * `data: <AgentStreamEvent JSON>` — `answer_delta`s carry grounded, leak-scanned
 * text and one terminal event closes it. Always HTTP 200: the stream has
 * committed once it opens, so upstream failures are terminal events, not status
 * codes. Additive to the buffered JSON path, which stays the no-JS + health
 * probe surface.
 */
function streamResponse(
  service: AgentService,
  question: string,
  requestId: string,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      try {
        for await (const event of service.askStream(question, requestId)) {
          send(event);
        }
      } catch {
        structuredLog({ event: "ask.unhandled_error", requestId });
        send({ kind: "upstream_error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

/**
 * Worker env access. `cloudflare:workers` is the only supported source in
 * the deployed Worker and under `wrangler dev` — the adapter's
 * `locals.runtime.env` is a removed API whose property access throws. The
 * module doesn't resolve in Node (vitest), so tests keep injecting env
 * through `locals`.
 */
async function resolveEnv(locals: unknown): Promise<AskEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as AskEnv;
  } catch {
    return (locals as { runtime?: { env?: AskEnv } }).runtime?.env ?? {};
  }
}

/**
 * Adapter selection: the live Anthropic adapter when the Worker secret is
 * present (Phase 4), the deterministic fake otherwise (local dev, CI,
 * previews — which are host-gated off anyway). Model id and base URL are
 * config-driven bindings, never hard-coded (spec §2).
 */
function selectAdapter(env: AskEnv): ModelAdapter {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicAdapter({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      baseURL: env.ANTHROPIC_BASE_URL,
    });
  }
  return new FakeModelAdapter({ mode: "echo-first-citation" });
}

const handleAsk: APIRoute = async (context) => {
  const requestId = crypto.randomUUID();
  const { request, locals } = context;

  // Host gate: previews and any non-canonical host never expose the agent.
  const host = new URL(request.url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (host !== CANONICAL_HOST && !isLocal) {
    return errorResponse("not_found", requestId);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse("invalid_request", requestId);
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    return errorResponse("invalid_request", requestId);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    return errorResponse("invalid_request", requestId);
  }
  const parsed = askRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return errorResponse("invalid_request", requestId);
  }

  // Rate limiting via the GA Workers binding, keyed on Cloudflare's trusted
  // client IP header (spec §10 — never trust browser-supplied IP info).
  const env = await resolveEnv(locals);
  const limiter = env.ASK_RATE_LIMITER;
  if (limiter) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await limiter.limit({ key });
    if (!success) {
      structuredLog({ event: "ask.provider_rate_limited", requestId });
      return errorResponse("rate_limited", requestId);
    }
  }

  const service = new AgentService(
    corpusJson as Corpus,
    selectAdapter(env),
    structuredLog,
  );

  // Progressive enhancement: JS clients opt into streaming via Accept; every
  // other caller (no-JS, the deploy smoke, uptime-ask) gets the buffered JSON.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return streamResponse(service, parsed.data.question, requestId);
  }

  const outcome = await service.ask(parsed.data.question, requestId);

  switch (outcome.kind) {
    case "answered":
      return new Response(
        JSON.stringify({
          answer: outcome.answer,
          citations: outcome.citations,
          sources: outcome.sources,
          requestId,
        }),
        { status: 200, headers: jsonHeaders },
      );
    case "refused":
      return new Response(
        JSON.stringify({
          answer: outcome.answer,
          citations: [],
          sources: [],
          requestId,
        }),
        { status: 200, headers: jsonHeaders },
      );
    case "upstream_rate_limited":
      return errorResponse("rate_limited", requestId);
    case "upstream_error":
      return errorResponse("upstream_error", requestId);
  }
};

// Last-resort guard: whatever throws, the caller still gets the stable JSON
// error envelope (spec §10) instead of the platform's bare 500.
export const POST: APIRoute = async (context) => {
  try {
    return await handleAsk(context);
  } catch {
    const requestId = crypto.randomUUID();
    structuredLog({ event: "ask.unhandled_error", requestId });
    return errorResponse("upstream_error", requestId);
  }
};

export const ALL: APIRoute = ({ request }) => {
  const requestId = crypto.randomUUID();
  if (request.method === "POST") {
    // Astro routes POST to the handler above; ALL only sees other methods.
    return errorResponse("method_not_allowed", requestId);
  }
  return errorResponse("method_not_allowed", requestId);
};
