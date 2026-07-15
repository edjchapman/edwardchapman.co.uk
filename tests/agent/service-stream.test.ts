import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";
import {
  FakeModelAdapter,
  type ModelAdapter,
  type ModelStreamEvent,
} from "../../src/lib/agent/adapter";
import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";
import {
  AgentService,
  type AgentStreamEvent,
} from "../../src/lib/agent/service";

/**
 * Streaming service (ADR-0016): the grounding buffer and leak scan are the
 * safety-critical core, so their behaviours are pinned end-to-end through
 * askStream — an ungrounded answer is never revealed, a policy leak aborts
 * before it ships, and every terminal maps to the right event.
 */

const corpus = buildCorpus(process.cwd());
const CONFIDENT_Q = "How did Foreman handle reliable event processing?";
const REFUSE_Q = "What's the weather in London today?";

function service(adapter: ModelAdapter): AgentService {
  return new AgentService(corpus, adapter, () => {});
}

/** An adapter that streams a fixed script; complete() is never used here. */
function scripted(events: ModelStreamEvent[]): ModelAdapter {
  return {
    complete: () => Promise.reject(new Error("unused in streaming tests")),
    async *stream() {
      for (const event of events) yield event;
    },
  };
}

async function collect(
  stream: AsyncIterable<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerText = (events: AgentStreamEvent[]): string =>
  events
    .filter(
      (event): event is { kind: "answer_delta"; text: string } =>
        event.kind === "answer_delta",
    )
    .map((event) => event.text)
    .join("");

describe("AgentService.askStream", () => {
  it("streams a grounded answer, then a terminal with citations and sources", async () => {
    const events = await collect(
      service(
        scripted([
          { type: "text", delta: "Foreman uses a transactional outbox." },
          {
            type: "citation",
            citation: { start: 0, end: 7, documentIndex: 0 },
          },
          { type: "completed" },
        ]),
      ).askStream(CONFIDENT_Q, "req-1"),
    );

    expect(answerText(events)).toBe("Foreman uses a transactional outbox.");
    const terminal = events.at(-1);
    expect(terminal?.kind).toBe("answered");
    if (terminal?.kind !== "answered") throw new Error("expected answered");
    expect(terminal.citations.length).toBeGreaterThan(0);
    expect(terminal.sources.length).toBeGreaterThan(0);
  });

  it("never reveals an ungrounded answer — zero citations refuses", async () => {
    const secret = "Ed secretly runs a startup nobody has published.";
    const events = await collect(
      service(
        scripted([{ type: "text", delta: secret }, { type: "completed" }]),
      ).askStream(CONFIDENT_Q, "req-2"),
    );

    expect(answerText(events)).toBe(""); // grounding buffer never opened
    expect(events).toContainEqual({
      kind: "refused",
      answer: REFUSAL_TEXT,
      reason: "no_citations",
    });
    expect(answerText(events)).not.toContain(secret);
  });

  it("does not count a citation indexing an unsupplied passage", async () => {
    const events = await collect(
      service(
        scripted([
          { type: "text", delta: "Grounded-looking but uncited." },
          {
            type: "citation",
            citation: { start: 0, end: 5, documentIndex: 99 },
          },
          { type: "completed" },
        ]),
      ).askStream(CONFIDENT_Q, "req-3"),
    );
    expect(answerText(events)).toBe("");
    expect(events.at(-1)).toMatchObject({
      kind: "refused",
      reason: "no_citations",
    });
  });

  it("refuses pre-model on low confidence without opening a stream", async () => {
    const adapter: ModelAdapter = {
      complete: () => Promise.reject(new Error("must not run")),
      stream: () => {
        throw new Error("must not open a model stream on refusal");
      },
    };
    const events = await collect(service(adapter).askStream(REFUSE_Q, "req-4"));
    expect(events).toEqual([
      { kind: "refused", answer: REFUSAL_TEXT, reason: "low_confidence" },
    ]);
  });

  it("aborts with upstream_error and emits no fingerprint on a policy leak", async () => {
    const events = await collect(
      service(new FakeModelAdapter({ mode: "leak-system-prompt" })).askStream(
        CONFIDENT_Q,
        "req-5",
      ),
    );
    expect(events.at(-1)).toEqual({ kind: "upstream_error" });
    const streamed = answerText(events);
    expect(streamed).toBe("");
    expect(streamed).not.toContain(
      'the "ask" assistant on edwardchapman.co.uk',
    );
    expect(streamed).not.toContain("Rules, in priority order");
  });

  it("treats a refusal sentence carrying a citation as a refusal, not an answer", async () => {
    const events = await collect(
      service(
        new FakeModelAdapter({ mode: "refusal-with-citations" }),
      ).askStream(CONFIDENT_Q, "req-6"),
    );
    expect(answerText(events)).toBe(""); // never streamed as an answer
    expect(events.at(-1)).toEqual({
      kind: "refused",
      answer: REFUSAL_TEXT,
      reason: "model_declined",
    });
  });

  it.each([
    ["timeout", "upstream_error"],
    ["rate_limited", "upstream_rate_limited"],
    ["provider_error", "upstream_error"],
  ] as const)("maps a %s terminal to %s", async (mode, kind) => {
    const events = await collect(
      service(new FakeModelAdapter({ mode })).askStream(CONFIDENT_Q, "req-7"),
    );
    expect(answerText(events)).toBe("");
    expect(events.at(-1)).toEqual({ kind });
  });
});
