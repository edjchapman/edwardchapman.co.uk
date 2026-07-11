import type { APIRoute } from "astro";

import corpusJson from "../../generated/corpus.json";
import type { Corpus } from "../../../scripts/build-agent-corpus.ts";
import {
  FakeModelAdapter,
  type ModelAdapter,
} from "../../lib/agent/adapter.ts";
import { askRequestSchema, MAX_BODY_BYTES } from "../../lib/agent/schema.ts";
import { AgentService, type AgentLogger } from "../../lib/agent/service.ts";

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
 * Adapter selection: Phase 3 ships the deterministic fake (the /ask UI is
 * unadvertised); Phase 4 swaps in the Anthropic adapter behind the same
 * interface, keyed off ANTHROPIC_API_KEY's presence.
 */
function selectAdapter(_env: AskEnv): ModelAdapter {
  return new FakeModelAdapter({ mode: "echo-first-citation" });
}

export const POST: APIRoute = async (context) => {
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
  const env = (locals as { runtime?: { env?: AskEnv } }).runtime?.env ?? {};
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
  const outcome = await service.ask(parsed.data.question, requestId);

  switch (outcome.kind) {
    case "answered":
      return new Response(
        JSON.stringify({
          answer: outcome.answer,
          sources: outcome.sources,
          requestId,
        }),
        { status: 200, headers: jsonHeaders },
      );
    case "refused":
      return new Response(
        JSON.stringify({ answer: outcome.answer, sources: [], requestId }),
        { status: 200, headers: jsonHeaders },
      );
    case "upstream_rate_limited":
      return errorResponse("rate_limited", requestId);
    case "upstream_error":
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
