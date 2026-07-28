import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";
import { signQuotaValue } from "../../src/lib/agent/quota";
import { askResponseSchema } from "../../src/lib/agent/schema";
import type { AgentStreamEvent } from "../../src/lib/agent/service";
import { ALL, POST } from "../../src/pages/api/ask";

const ENDPOINT = "http://localhost/api/ask";
const PRODUCTION_ENDPOINT = "https://edwardchapman.co.uk/api/ask";

// The Foreman question is a baseline hit (a pinned chip, ADR-0027), so it
// short-circuits before quota and the adapter. Tests that must exercise the
// *model* path use a nonce-suffixed variant: it misses the exact-match
// baseline but still retrieves Foreman confidently (an unmatched token adds
// nothing to the lexical score).
const MODEL_Q = "How did Foreman handle reliable event processing? probe-42";

type RouteContext = Parameters<typeof POST>[0];

function makeContext(
  request: Request,
  env: Record<string, unknown> = {},
): RouteContext {
  return { request, locals: { runtime: { env } } } as unknown as RouteContext;
}

function postJson(
  body: unknown,
  options: {
    url?: string;
    contentType?: string;
    env?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const request = new Request(options.url ?? ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...options.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(makeContext(request, options.env ?? {})) as Promise<Response>;
}

describe("POST /api/ask contract", () => {
  it("answers a supported question with citations, sources and a requestId", async () => {
    const response = await postJson({ question: MODEL_Q });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    // The shared contract schema enforces the span invariants (spec §10):
    // half-open ranges into answer, sourceIndex into sources, sorted starts.
    const parsed = askResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.answer.length).toBeGreaterThan(0);
      expect(parsed.data.citations.length).toBeGreaterThan(0);
      expect(parsed.data.sources.length).toBeGreaterThan(0);
      expect(parsed.data.served).toBe("model");
      expect(parsed.data.requestId).toMatch(/[0-9a-f-]{36}/);
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a pinned baseline question without a model call, even with no credential", async () => {
    // The outage-proof pin: on the canonical host, no ANTHROPIC_API_KEY, a
    // chip question is answered from the baseline (ADR-0027) — the exact case
    // that would 503 through the model path.
    const response = await postJson(
      { question: "How did Foreman handle reliable event processing?" },
      { url: PRODUCTION_ENDPOINT },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      sources: unknown[];
      served: string;
    };
    expect(body.served).toBe("baseline");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("serves a baseline hit as buffered JSON even to an SSE client", async () => {
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ question: "What is Foreman?" }),
    });
    const response = (await POST(makeContext(request, {}))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { served: string };
    expect(body.served).toBe("baseline");
  });

  it("fails closed on the canonical host when the model credential is absent", async () => {
    const response = await postJson(
      { question: MODEL_Q },
      { url: PRODUCTION_ENDPOINT },
    );
    // A missing credential is the non-retryable class: 503, not 502 (ADR-0026).
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });

  it("maps a non-retryable provider failure to 503 without leaking detail", async () => {
    const response = await postJson(
      { question: MODEL_Q },
      { url: PRODUCTION_ENDPOINT, env: { ASK_MODEL_MODE: "fail-unavailable" } },
    );
    expect(response.status).toBe(503);
    const raw = await response.text();
    // The class name and friendly copy only — never the provider detail
    // (status 400 / invalid_request_error / anthropic) (spec §10).
    expect(raw).not.toMatch(/status 400|invalid_request|anthropic/i);
    const body = JSON.parse(raw) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toContain("temporarily offline");
  });

  it("maps a transient provider failure to 502", async () => {
    const response = await postJson(
      { question: MODEL_Q },
      { url: PRODUCTION_ENDPOINT, env: { ASK_MODEL_MODE: "fail-transient" } },
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_error");
  });

  it("keeps local requests deterministic even when a model credential exists", async () => {
    const response = await postJson(
      { question: MODEL_Q },
      {
        env: {
          ANTHROPIC_API_KEY: "test-only-key",
          ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
        },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: unknown[] };
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("supports the explicit fake binding used by the local Worker", async () => {
    const response = await postJson(
      { question: MODEL_Q },
      {
        url: PRODUCTION_ENDPOINT,
        env: { ASK_MODEL_MODE: "fake" },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: unknown[] };
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("refuses unsupported questions with the exact refusal form", async () => {
    const response = await postJson({
      question: "What's the weather in London today?",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      citations: unknown[];
      sources: unknown[];
    };
    expect(body.answer).toBe(REFUSAL_TEXT);
    expect(body.citations).toEqual([]);
    expect(body.sources).toEqual([]);
  });

  it("rejects non-JSON content types", async () => {
    const response = await postJson("question=hi", {
      contentType: "text/plain",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects malformed JSON, empty and missing questions", async () => {
    expect((await postJson("{not json")).status).toBe(400);
    expect((await postJson({ question: "   " })).status).toBe(400);
    expect((await postJson({})).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const response = await postJson({ question: "x".repeat(5000) });
    expect(response.status).toBe(400);
  });

  it("normalises whitespace before validating length", async () => {
    const response = await postJson({
      question: `  How   did Foreman \n\n handle reliable   event processing?  `,
    });
    expect(response.status).toBe(200);
  });

  it("is host-gated: non-canonical hosts get 404", async () => {
    const response = await postJson(
      { question: "How did Foreman handle reliable event processing?" },
      { url: "https://pr-9-edwardchapman.example.workers.dev/api/ask" },
    );
    expect(response.status).toBe(404);
  });

  it("enforces the rate-limit binding when present", async () => {
    const response = await postJson(
      { question: "How did Foreman handle reliable event processing?" },
      {
        env: {
          ASK_RATE_LIMITER: {
            limit: () => Promise.resolve({ success: false }),
          },
        },
      },
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("rejects non-POST methods via the catch-all", async () => {
    const request = new Request(ENDPOINT, { method: "GET" });
    const response = (await ALL(makeContext(request))) as Response;
    expect(response.status).toBe(405);
  });

  it("never exposes provider details or stack traces in errors", async () => {
    const response = await postJson("{broken");
    const text = await response.text();
    expect(text).not.toMatch(/stack|anthropic|trace|Error:/i);
  });
});

describe("adversarial cases (deterministic invariants)", () => {
  type AdversarialCases = {
    cases: {
      id: string;
      question: string;
      generate?: { repeat: string; times: number };
    }[];
  };
  const fixtures: AdversarialCases = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests/agent/adversarial-questions.json"),
      "utf8",
    ),
  );

  for (const testCase of fixtures.cases) {
    it(`${testCase.id}: no leak, no unwhitelisted citation`, async () => {
      const question = testCase.generate
        ? testCase.generate.repeat.repeat(testCase.generate.times)
        : testCase.question;
      const response = await postJson({ question });

      if (response.status === 400) return; // rejected by validation: fine

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        answer: string;
        citations?: { start: number; end: number; sourceIndex: number }[];
        sources: { url: string }[];
      };
      // Whatever happened, the policy never leaks, sources stay on-origin,
      // and any citation surface satisfies the span invariants.
      expect(body.answer).not.toContain("Rules, in priority order");
      expect(body.answer.toLowerCase()).not.toContain("system policy");
      for (const source of body.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
      }
      for (const citation of body.citations ?? []) {
        expect(citation.start).toBeGreaterThanOrEqual(0);
        expect(citation.start).toBeLessThan(citation.end);
        expect(citation.end).toBeLessThanOrEqual(body.answer.length);
        expect(citation.sourceIndex).toBeGreaterThanOrEqual(0);
        expect(citation.sourceIndex).toBeLessThan(body.sources.length);
      }
    });
  }
});

describe("per-visitor quota (ADR-0024)", () => {
  const QUESTION = MODEL_Q;
  const QUOTA_ENV = {
    ASK_MODEL_MODE: "fake",
    ASK_QUOTA_SECRET: "test-secret",
    ASK_QUOTA_LIMIT: "2",
  };
  const nowSec = () => Math.floor(Date.now() / 1000);

  it("sets a signed quota cookie on the first answer", async () => {
    const response = await postJson(
      { question: QUESTION },
      { url: PRODUCTION_ENDPOINT, env: QUOTA_ENV },
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ask_quota=v1.");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/api/ask");
  });

  it("omits Secure on local requests", async () => {
    const response = await postJson({ question: QUESTION }, { env: QUOTA_ENV });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ask_quota=v1.");
    expect(cookie).not.toContain("Secure");
  });

  it("returns the quota_exceeded envelope at the limit", async () => {
    const atLimit = await signQuotaValue(nowSec() - 60, 2, "test-secret");
    const response = await postJson(
      { question: QUESTION },
      {
        url: PRODUCTION_ENDPOINT,
        env: QUOTA_ENV,
        headers: { cookie: `ask_quota=${atLimit}` },
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.message).toContain("today's question limit");
  });

  it("sets the cookie on the SSE path too", async () => {
    const request = new Request(`${PRODUCTION_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ question: QUESTION }),
    });
    const response = (await POST(makeContext(request, QUOTA_ENV))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("set-cookie")).toContain("ask_quota=v1.");
  });

  it("denies an exhausted SSE client with plain JSON, not a stream", async () => {
    const atLimit = await signQuotaValue(nowSec() - 60, 2, "test-secret");
    const request = new Request(`${PRODUCTION_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        cookie: `ask_quota=${atLimit}`,
      },
      body: JSON.stringify({ question: QUESTION }),
    });
    const response = (await POST(makeContext(request, QUOTA_ENV))) as Response;
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("sets no cookie on rejected requests", async () => {
    const response = await postJson("question=hi", {
      url: PRODUCTION_ENDPOINT,
      env: QUOTA_ENV,
      contentType: "text/plain",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("skips the quota (no cookie) when the secret is absent", async () => {
    const response = await postJson(
      { question: QUESTION },
      { url: PRODUCTION_ENDPOINT, env: { ASK_MODEL_MODE: "fake" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not charge the quota on an upstream failure (ADR-0026)", async () => {
    // A fresh visitor whose model call fails gets no set-cookie, so the
    // increment never persists — the next request is back where they started.
    const response = await postJson(
      { question: QUESTION },
      {
        url: PRODUCTION_ENDPOINT,
        env: { ...QUOTA_ENV, ASK_MODEL_MODE: "fail-unavailable" },
      },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

async function postStream(
  question: string,
): Promise<{ response: Response; events: AgentStreamEvent[] }> {
  const request = new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ question }),
  });
  const response = (await POST(makeContext(request, {}))) as Response;
  const text = await response.text();
  const events = text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)) as AgentStreamEvent);
  return { response, events };
}

describe("POST /api/ask streaming (ADR-0016)", () => {
  it("streams answer deltas then an answered terminal for a supported question", async () => {
    const { response, events } = await postStream(MODEL_Q);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const answer = events
      .filter((event) => event.kind === "answer_delta")
      .map((event) => (event.kind === "answer_delta" ? event.text : ""))
      .join("");
    expect(answer.length).toBeGreaterThan(0);

    const terminal = events.at(-1);
    expect(terminal?.kind).toBe("answered");
    if (terminal?.kind === "answered") {
      expect(terminal.citations.length).toBeGreaterThan(0);
      expect(terminal.sources.length).toBeGreaterThan(0);
      for (const source of terminal.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
      }
    }
  });

  it("streams a single refused terminal (no answer text) for an unsupported question", async () => {
    const { response, events } = await postStream(
      "What's the weather in London today?",
    );
    expect(response.status).toBe(200);
    expect(events).toEqual([
      { kind: "refused", answer: REFUSAL_TEXT, reason: "low_confidence" },
    ]);
  });

  it("keeps the buffered JSON contract when the client does not opt into streaming", async () => {
    const response = await postJson({ question: MODEL_Q });
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { answer: string };
    expect(typeof body.answer).toBe("string");
  });

  it("closes a stream with an upstream_unavailable terminal, still HTTP 200", async () => {
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ question: MODEL_Q }),
    });
    const response = (await POST(
      makeContext(request, { ASK_MODEL_MODE: "fail-unavailable" }),
    )) as Response;
    // The stream commits at open, so the non-retryable failure is a terminal
    // event on a 200, not a 503 (ADR-0016 invariant).
    expect(response.status).toBe(200);
    const text = await response.text();
    const events = text
      .split("\n\n")
      .filter((block) => block.startsWith("data: "))
      .map((block) => JSON.parse(block.slice(6)) as AgentStreamEvent);
    expect(events.at(-1)?.kind).toBe("upstream_unavailable");
  });
});
