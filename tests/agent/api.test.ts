import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";
import { askResponseSchema } from "../../src/lib/agent/schema";
import type { AgentStreamEvent } from "../../src/lib/agent/service";
import { ALL, POST } from "../../src/pages/api/ask";

const ENDPOINT = "https://edwardchapman.co.uk/api/ask";

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
  } = {},
): Promise<Response> {
  const request = new Request(options.url ?? ENDPOINT, {
    method: "POST",
    headers: { "content-type": options.contentType ?? "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(makeContext(request, options.env ?? {})) as Promise<Response>;
}

describe("POST /api/ask contract", () => {
  it("answers a supported question with citations, sources and a requestId", async () => {
    const response = await postJson({
      question: "How did Foreman handle reliable event processing?",
    });
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
      expect(parsed.data.requestId).toMatch(/[0-9a-f-]{36}/);
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    const { response, events } = await postStream(
      "How did Foreman handle reliable event processing?",
    );
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
    const response = await postJson({
      question: "How did Foreman handle reliable event processing?",
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { answer: string };
    expect(typeof body.answer).toBe("string");
  });
});
