import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";
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
  it("answers a supported question with sources and a requestId", async () => {
    const response = await postJson({
      question: "How did Foreman handle reliable event processing?",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      sources: { title: string; url: string }[];
      requestId: string;
    };
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses unsupported questions with the exact refusal form", async () => {
    const response = await postJson({
      question: "What's the weather in London today?",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      sources: unknown[];
    };
    expect(body.answer).toBe(REFUSAL_TEXT);
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
        sources: { url: string }[];
      };
      // Whatever happened, the policy never leaks and sources stay on-origin.
      expect(body.answer).not.toContain("Rules, in priority order");
      expect(body.answer.toLowerCase()).not.toContain("system policy");
      for (const source of body.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk/);
      }
    });
  }
});
