import type { APIRoute } from "astro";

import baselineJson from "../../generated/baseline.json";
import corpusJson from "../../generated/corpus.json";
import type { Corpus } from "../../../scripts/build-agent-corpus.ts";
import {
  FakeModelAdapter,
  type FakeBehaviour,
  type ModelAdapter,
} from "../../lib/agent/adapter.ts";
import { AnthropicAdapter } from "../../lib/agent/anthropic-adapter.ts";
import {
  createBaselineLookup,
  type BaselineAnswers,
  type BaselineEntry,
} from "../../lib/agent/baseline.ts";
import {
  INVALID_REQUEST_MESSAGE,
  METHOD_NOT_ALLOWED_MESSAGE,
  NOT_FOUND_MESSAGE,
  QUOTA_EXCEEDED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UPSTREAM_ERROR_MESSAGE,
  UPSTREAM_UNAVAILABLE_MESSAGE,
} from "../../lib/agent/ask-copy.ts";
import { DEFAULT_QUOTA_LIMIT, evaluateQuota } from "../../lib/agent/quota.ts";
import { askRequestSchema, MAX_BODY_BYTES } from "../../lib/agent/schema.ts";
import {
  AgentService,
  type AgentLogger,
  type AgentStreamEvent,
} from "../../lib/agent/service.ts";

export const prerender = false;

const CANONICAL_HOST = "edwardchapman.co.uk";

// Exact-match pre-answered questions (ADR-0027), built once at module init.
const lookupBaseline = createBaselineLookup(baselineJson as BaselineAnswers);

type ErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "rate_limited"
  | "quota_exceeded"
  | "not_found"
  | "upstream_error"
  | "upstream_unavailable";

// 502 vs 503 splits the two upstream classes at the HTTP layer (ADR-0026):
// 502 upstream_error is a transient bad-gateway (a retry may succeed); 503
// upstream_unavailable is "service unable" — down until the operator acts —
// so status alone tells the monitors and any status-based tooling apart.
const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  method_not_allowed: 405,
  rate_limited: 429,
  quota_exceeded: 429,
  not_found: 404,
  upstream_error: 502,
  upstream_unavailable: 503,
};

// Assembled from ask-copy.ts (the single source of truth the AskForm island
// also imports) — the Record type forces every code to have copy.
const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: INVALID_REQUEST_MESSAGE,
  method_not_allowed: METHOD_NOT_ALLOWED_MESSAGE,
  rate_limited: RATE_LIMITED_MESSAGE,
  quota_exceeded: QUOTA_EXCEEDED_MESSAGE,
  not_found: NOT_FOUND_MESSAGE,
  upstream_error: UPSTREAM_ERROR_MESSAGE,
  upstream_unavailable: UPSTREAM_UNAVAILABLE_MESSAGE,
};

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AskEnv {
  ASK_RATE_LIMITER?: RateLimitBinding;
  ASK_MODEL_MODE?: string;
  ASK_QUOTA_SECRET?: string;
  ASK_QUOTA_LIMIT?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ASK_AI_GATEWAY_TOKEN?: string;
}

/** Wrangler vars arrive as strings; anything unparseable keeps the default. */
function parseQuotaLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTA_LIMIT;
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
  // Structured events. Per ADR-0023 the accepted event carries the question
  // text for abuse monitoring (disclosed on /privacy, expiring with the
  // platform's log retention); answers are never logged.
  console.log(JSON.stringify(event));
};

/**
 * Serve a pre-answered baseline entry as buffered JSON (ADR-0027) — even to
 * SSE clients (the island's dual-mode path renders it). `served: "baseline"`
 * is the honesty + observability marker: the monitors assert `served ==
 * "model"` so a baseline hit can never mask a dead model path (ADR-0018). The
 * accepted event still records the question (ADR-0023 abuse-monitoring parity);
 * a distinct `ask.baseline_served` carries only the entry id.
 */
function baselineResponse(
  entry: BaselineEntry,
  question: string,
  requestId: string,
): Response {
  structuredLog({
    event: "ask.accepted",
    requestId,
    question: question.slice(0, 500),
  });
  structuredLog({ event: "ask.baseline_served", requestId, detail: entry.id });
  return new Response(
    JSON.stringify({
      answer: entry.answer,
      citations: entry.citations,
      sources: entry.sources,
      served: "baseline",
      requestId,
    }),
    { status: 200, headers: jsonHeaders },
  );
}

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
 * Fake-adapter behaviour from the explicit ASK_MODEL_MODE binding (ADR-0018).
 * The two `fail-*` modes let the offline/transient degraded states be driven
 * end-to-end under `wrangler dev` for manual and live verification; they are
 * checked before the isLocal echo default so local dev can simulate a failure.
 * `undefined` means "no fake" — fall through to the real adapter.
 */
function fakeBehaviourFor(
  env: AskEnv,
  isLocal: boolean,
): FakeBehaviour | undefined {
  if (env.ASK_MODEL_MODE === "fail-unavailable")
    return { mode: "provider_unavailable" };
  if (env.ASK_MODEL_MODE === "fail-transient")
    return { mode: "provider_error" };
  if (isLocal || env.ASK_MODEL_MODE === "fake")
    return { mode: "echo-first-citation" };
  return undefined;
}

/**
 * Adapter selection is environment-explicit (ADR-0018): local requests always
 * use the deterministic fake, while the canonical host requires its Worker
 * secret. Model id and base URL are config-driven bindings, never hard-coded
 * (spec §2).
 */
function selectAdapter(
  env: AskEnv,
  isLocal: boolean,
): ModelAdapter | undefined {
  const fake = fakeBehaviourFor(env, isLocal);
  if (fake) return new FakeModelAdapter(fake);
  if (!env.ANTHROPIC_API_KEY) return undefined;
  return new AnthropicAdapter({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    baseURL: env.ANTHROPIC_BASE_URL,
    gatewayToken: env.ASK_AI_GATEWAY_TOKEN,
  });
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

  // Pre-answered baseline (ADR-0027): exact-match questions short-circuit
  // here — after the IP limiter, before the quota gate (a hit costs nothing,
  // so it never spends the visitor's daily budget) and before adapter
  // selection (it needs no credential, so example chips answer through an
  // outage). This call site is the serving-policy switch. SSE clients get
  // buffered JSON; the island's fallback renders it.
  const baselineHit = lookupBaseline(parsed.data.question);
  if (baselineHit) {
    return baselineResponse(baselineHit, parsed.data.question, requestId);
  }

  // Per-visitor quota (ADR-0024): a signed cookie counts questions per 24h
  // window; the server stays stateless. Absent secret ⇒ layer off — logged,
  // and the live security probe fails if production ever runs without it.
  let quotaCookie: string | undefined;
  if (env.ASK_QUOTA_SECRET) {
    const decision = await evaluateQuota({
      cookieHeader: request.headers.get("cookie"),
      secret: env.ASK_QUOTA_SECRET,
      limit: parseQuotaLimit(env.ASK_QUOTA_LIMIT),
      nowMs: Date.now(),
      secure: !isLocal,
    });
    if (!decision.allowed) {
      structuredLog({ event: "ask.quota_exceeded", requestId });
      return errorResponse("quota_exceeded", requestId);
    }
    quotaCookie = decision.setCookie;
  } else if (!isLocal) {
    structuredLog({ event: "ask.quota_skipped", requestId });
  }
  const withQuota = (response: Response): Response => {
    if (quotaCookie) response.headers.append("set-cookie", quotaCookie);
    return response;
  };

  const adapter = selectAdapter(env, isLocal);
  if (!adapter) {
    // A missing credential is an operator-actionable outage, not a transient
    // blip: the non-retryable class, and (like all upstream failures) it does
    // not burn the visitor's quota (ADR-0026 amends ADR-0024).
    structuredLog({
      event: "ask.provider_unavailable",
      requestId,
      detail: "missing_model_credential",
    });
    return errorResponse("upstream_unavailable", requestId);
  }

  const service = new AgentService(
    corpusJson as Corpus,
    adapter,
    structuredLog,
  );

  // Progressive enhancement: JS clients opt into streaming via Accept; every
  // other caller (no-JS, the deploy smoke, uptime-ask) gets the buffered JSON.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return withQuota(streamResponse(service, parsed.data.question, requestId));
  }

  const outcome = await service.ask(parsed.data.question, requestId);

  switch (outcome.kind) {
    case "answered":
      return withQuota(
        new Response(
          JSON.stringify({
            answer: outcome.answer,
            citations: outcome.citations,
            sources: outcome.sources,
            served: "model",
            requestId,
          }),
          { status: 200, headers: jsonHeaders },
        ),
      );
    case "refused":
      return withQuota(
        new Response(
          JSON.stringify({
            answer: outcome.answer,
            citations: [],
            sources: [],
            served: "model",
            requestId,
          }),
          { status: 200, headers: jsonHeaders },
        ),
      );
    // Upstream failures do not attach the incremented cookie, so the count
    // never persists — a natural refund for a question that got no answer
    // (ADR-0026 amends ADR-0024). Refusals above still count: the visitor got
    // a truthful answer.
    case "upstream_rate_limited":
      return errorResponse("rate_limited", requestId);
    case "upstream_unavailable":
      return errorResponse("upstream_unavailable", requestId);
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
