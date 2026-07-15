import { describe, expect, it } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicAdapterConfig,
} from "../../src/lib/agent/anthropic-adapter";
import type {
  ModelRequest,
  ModelStreamEvent,
} from "../../src/lib/agent/adapter";
import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";

/**
 * Deterministic coverage for the live adapter (ADR-0012): the transport is a
 * stubbed fetch, so the real SDK still performs request serialisation and
 * typed-error classification — the exact behaviours under test. No network,
 * no key.
 */

type RecordedCall = { url: string; init: RequestInit };

function stubFetch(responses: (Response | Error)[]): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchImpl = (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("stubFetch: response queue exhausted");
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { fetch: fetchImpl as typeof globalThis.fetch, calls };
}

function messageResponse(content: unknown[]): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errorResponse(status: number): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "stubbed failure" },
    }),
    {
      status,
      // retry-after: 0 keeps the SDK's automatic retry from sleeping.
      headers: { "content-type": "application/json", "retry-after": "0" },
    },
  );
}

function sseResponse(events: { event: string; data: unknown }[]): Response {
  const body = events
    .map(
      (entry) =>
        `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`,
    )
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collectStream(
  stream: AsyncIterable<ModelStreamEvent>,
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function searchCitation(index: number): unknown {
  return {
    type: "search_result_location",
    cited_text: "Outbox pattern text.",
    search_result_index: index,
    start_block_index: 0,
    end_block_index: 1,
    source: "https://edwardchapman.co.uk/projects/foreman",
    title: "Foreman — Card",
  };
}

function textBlock(text: string, citations?: unknown[]): unknown {
  return { type: "text", text, citations: citations ?? null };
}

const DOCUMENTS = [
  {
    sectionId: "foreman#card",
    title: "Foreman — Card",
    url: "https://edwardchapman.co.uk/projects/foreman",
    text: "Outbox pattern text.",
  },
  {
    sectionId: "foreman#architecture",
    title: "Foreman — Architecture",
    url: "https://edwardchapman.co.uk/projects/foreman",
    text: "Idempotent workers text.",
  },
];

const REQUEST: ModelRequest = {
  system: "You are the test policy.",
  documents: DOCUMENTS,
  question: "Answer this visitor question: how does Foreman work?",
};

function makeAdapter(
  fetchImpl: typeof globalThis.fetch,
  config: Partial<AnthropicAdapterConfig> = {},
): AnthropicAdapter {
  return new AnthropicAdapter({
    apiKey: "test-key",
    model: "claude-haiku-4-5",
    fetch: fetchImpl,
    ...config,
  });
}

describe("anthropic adapter outbound request", () => {
  it("sends search_result blocks with citations enabled and no output_config", async () => {
    const { fetch, calls } = stubFetch([
      messageResponse([textBlock("ok", [searchCitation(0)])]),
    ]);
    await makeAdapter(fetch).complete(REQUEST);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(call.init.headers as HeadersInit).get("x-api-key")).toBe(
      "test-key",
    );

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: "You are the test policy.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "search_result",
              source: "https://edwardchapman.co.uk/projects/foreman",
              title: "Foreman — Card",
              content: [{ type: "text", text: "Outbox pattern text." }],
              citations: { enabled: true },
            },
            {
              type: "search_result",
              source: "https://edwardchapman.co.uk/projects/foreman",
              title: "Foreman — Architecture",
              content: [{ type: "text", text: "Idempotent workers text." }],
              citations: { enabled: true },
            },
            {
              type: "text",
              text: "Answer this visitor question: how does Foreman work?",
            },
          ],
        },
      ],
    });
    // The structured-output constraint is gone: citations and output_config
    // are mutually exclusive per request (ADR-0012).
    expect(body).not.toHaveProperty("output_config");
  });

  it("routes through the configured base URL (AI Gateway seam)", async () => {
    const { fetch, calls } = stubFetch([
      messageResponse([textBlock("ok", [searchCitation(0)])]),
    ]);
    await makeAdapter(fetch, {
      baseURL: "https://gateway.example.com/anthropic",
    }).complete(REQUEST);
    expect(calls[0]!.url).toBe(
      "https://gateway.example.com/anthropic/v1/messages",
    );
  });
});

describe("anthropic adapter response parsing", () => {
  it("assembles multi-block answers and maps cited blocks to spans", async () => {
    const { fetch } = stubFetch([
      messageResponse([
        textBlock("Foreman uses a transactional outbox", [searchCitation(0)]),
        textBlock(" and idempotent workers."),
      ]),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({
      type: "completion",
      answer: {
        text: "Foreman uses a transactional outbox and idempotent workers.",
        citations: [
          {
            start: 0,
            end: "Foreman uses a transactional outbox".length,
            documentIndex: 0,
          },
        ],
      },
    });
  });

  it("emits one citation per source when a block cites several", async () => {
    const { fetch } = stubFetch([
      messageResponse([
        textBlock("Grounded claim.", [searchCitation(0), searchCitation(1)]),
      ]),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    if (result.type !== "completion") throw new Error(result.type);
    expect(result.answer.citations).toEqual([
      { start: 0, end: 15, documentIndex: 0 },
      { start: 0, end: 15, documentIndex: 1 },
    ]);
  });

  it("maps search_result_index straight onto the documents order", async () => {
    const { fetch } = stubFetch([
      messageResponse([
        textBlock("From the second passage.", [searchCitation(1)]),
      ]),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    if (result.type !== "completion") throw new Error(result.type);
    expect(result.answer.citations[0]?.documentIndex).toBe(1);
  });

  it("returns an uncited completion when no block carries citations", async () => {
    const { fetch } = stubFetch([messageResponse([textBlock("Uncited.")])]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({
      type: "completion",
      answer: { text: "Uncited.", citations: [] },
    });
  });

  it("passes refusal text through verbatim", async () => {
    const { fetch } = stubFetch([messageResponse([textBlock(REFUSAL_TEXT)])]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    if (result.type !== "completion") throw new Error(result.type);
    expect(result.answer.text).toBe(REFUSAL_TEXT);
    expect(result.answer.citations).toEqual([]);
  });

  it("trims citation spans past whitespace and drops empty ones", async () => {
    const { fetch } = stubFetch([
      messageResponse([
        textBlock("Answer."),
        textBlock("   ", [searchCitation(0)]),
        textBlock("  padded  ", [searchCitation(1)]),
      ]),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    if (result.type !== "completion") throw new Error(result.type);
    expect(result.answer.text).toBe("Answer.     padded  ");
    // The whitespace-only block's citation is dropped; the padded block's
    // span shrinks to the visible characters.
    expect(result.answer.citations).toEqual([
      { start: 12, end: 18, documentIndex: 1 },
    ]);
  });

  it("skips non-text blocks defensively", async () => {
    const { fetch } = stubFetch([
      messageResponse([
        { type: "tool_use", id: "t1", name: "unexpected", input: {} },
        textBlock("Kept.", [searchCitation(0)]),
      ]),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    if (result.type !== "completion") throw new Error(result.type);
    expect(result.answer.text).toBe("Kept.");
  });

  it("treats an empty or whitespace-only completion as a provider error", async () => {
    const empty = await makeAdapter(
      stubFetch([messageResponse([])]).fetch,
    ).complete(REQUEST);
    expect(empty).toEqual({
      type: "provider_error",
      detail: "empty completion",
    });

    const blank = await makeAdapter(
      stubFetch([messageResponse([textBlock("   ")])]).fetch,
    ).complete(REQUEST);
    expect(blank).toEqual({
      type: "provider_error",
      detail: "empty completion",
    });
  });
});

describe("anthropic adapter error mapping", () => {
  it("maps connection failures to timeout (after the SDK retry)", async () => {
    const { fetch, calls } = stubFetch([
      new Error("network down"),
      new Error("network down"),
    ]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({ type: "timeout" });
    expect(calls.length).toBe(2); // maxRetries: 1 → two attempts
  });

  it("maps 429 to rate_limited", async () => {
    const { fetch } = stubFetch([errorResponse(429), errorResponse(429)]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({ type: "rate_limited" });
  });

  it("maps 500 to a provider error carrying status and error type", async () => {
    const { fetch } = stubFetch([errorResponse(500), errorResponse(500)]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({
      type: "provider_error",
      detail: "status 500 api_error",
    });
  });

  it("maps 400 to a provider error without retrying", async () => {
    const { fetch, calls } = stubFetch([errorResponse(400)]);
    const result = await makeAdapter(fetch).complete(REQUEST);
    expect(result).toEqual({
      type: "provider_error",
      detail: "status 400 api_error",
    });
    expect(calls.length).toBe(1);
  });
});

describe("anthropic adapter streaming (ADR-0016)", () => {
  const HAPPY_PATH = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        // Real ordering: the API announces the block's citation BEFORE its
        // text, so the span isn't known until content_block_stop.
        delta: { type: "citations_delta", citation: searchCitation(0) },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Foreman uses a transactional outbox and idempotent workers.",
        },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 50 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];

  it("resolves a citation announced before its text to the block span at stop", async () => {
    const { fetch, calls } = stubFetch([sseResponse(HAPPY_PATH)]);
    const events = await collectStream(makeAdapter(fetch).stream(REQUEST));

    // The request opts into streaming.
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(body["stream"]).toBe(true);

    // The citation arrived with no text yet; its span is resolved to the
    // block's full text range at content_block_stop (mirrors parseCompletion),
    // so it is emitted after the text — not dropped as an empty span.
    const answer =
      "Foreman uses a transactional outbox and idempotent workers.";
    expect(events).toEqual([
      { type: "text", delta: answer },
      {
        type: "citation",
        citation: { start: 0, end: answer.length, documentIndex: 0 },
      },
      { type: "completed" },
    ]);
  });

  it("maps a streaming connection failure to a timeout terminal event", async () => {
    const { fetch } = stubFetch([
      new Error("network down"),
      new Error("network down"),
    ]);
    const events = await collectStream(makeAdapter(fetch).stream(REQUEST));
    expect(events).toEqual([{ type: "timeout" }]);
  });

  it("maps a streaming 500 to a provider_error terminal event", async () => {
    const { fetch } = stubFetch([errorResponse(500), errorResponse(500)]);
    const events = await collectStream(makeAdapter(fetch).stream(REQUEST));
    expect(events).toEqual([
      { type: "provider_error", detail: "status 500 api_error" },
    ]);
  });
});
