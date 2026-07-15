import { describe, expect, it } from "vitest";

import {
  FakeModelAdapter,
  type ModelRequest,
  type ModelStreamEvent,
} from "../../src/lib/agent/adapter";
import { REFUSAL_TEXT } from "../../src/lib/agent/prompt";

/**
 * The fake adapter's streaming contract (ADR-0016): the deterministic suite and
 * the service's grounding-buffer / leak-scan logic drive off these event
 * sequences, so they are pinned here directly — text deltas that reassemble the
 * answer, citation events, and exactly one terminal event.
 */

const REQUEST: ModelRequest = {
  system: "You are the test policy.",
  documents: [
    {
      sectionId: "foreman#card",
      title: "Foreman — Card",
      url: "https://edwardchapman.co.uk/projects/foreman",
      text: "Outbox pattern text.",
    },
  ],
  question: "How does Foreman work?",
};

async function collect(
  stream: AsyncIterable<ModelStreamEvent>,
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const textOf = (events: ModelStreamEvent[]): string =>
  events
    .filter(
      (event): event is { type: "text"; delta: string } =>
        event.type === "text",
    )
    .map((event) => event.delta)
    .join("");

describe("FakeModelAdapter.stream", () => {
  it("streams text deltas that reassemble the answer, then citations, then completed", async () => {
    const events = await collect(
      new FakeModelAdapter({
        mode: "answer",
        text: "Foreman uses a transactional outbox and idempotent workers.",
        citations: [{ start: 0, end: 7, documentIndex: 0 }],
      }).stream(REQUEST),
    );

    expect(textOf(events)).toBe(
      "Foreman uses a transactional outbox and idempotent workers.",
    );
    expect(
      events.filter((event) => event.type === "text").length,
    ).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ type: "completed" });
    expect(events.filter((event) => event.type === "citation")).toEqual([
      { type: "citation", citation: { start: 0, end: 7, documentIndex: 0 } },
    ]);
    // Every citation event precedes the terminal completed.
    const completedAt = events.findIndex((event) => event.type === "completed");
    const lastCitationAt = events
      .map((event) => event.type)
      .lastIndexOf("citation");
    expect(lastCitationAt).toBeLessThan(completedAt);
  });

  it("echo-first-citation streams a grounded answer citing the first document", async () => {
    const events = await collect(
      new FakeModelAdapter({ mode: "echo-first-citation" }).stream(REQUEST),
    );
    expect(textOf(events)).toContain("foreman#card");
    expect(events.some((event) => event.type === "citation")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "completed" });
  });

  it("echo-first-citation with no documents completes without text or citations", async () => {
    const events = await collect(
      new FakeModelAdapter({ mode: "echo-first-citation" }).stream({
        ...REQUEST,
        documents: [],
      }),
    );
    expect(events).toEqual([{ type: "completed" }]);
  });

  it("streams the refusal sentence verbatim as text", async () => {
    const events = await collect(
      new FakeModelAdapter({ mode: "refusal-with-citations" }).stream(REQUEST),
    );
    expect(textOf(events)).toBe(REFUSAL_TEXT);
    expect(events.at(-1)).toEqual({ type: "completed" });
  });

  it("passes a leaking answer through as text so the service can catch it", async () => {
    const events = await collect(
      new FakeModelAdapter({ mode: "leak-system-prompt" }).stream(REQUEST),
    );
    expect(textOf(events)).toContain("You are the test policy.");
  });

  it("surfaces a hallucinated document index in a citation event", async () => {
    const events = await collect(
      new FakeModelAdapter({ mode: "hallucinate-citations" }).stream(REQUEST),
    );
    expect(
      events.some(
        (event) =>
          event.type === "citation" && event.citation.documentIndex === 99,
      ),
    ).toBe(true);
  });

  it.each(["timeout", "rate_limited", "provider_error"] as const)(
    "yields a single %s terminal event with no text",
    async (mode) => {
      const events = await collect(
        new FakeModelAdapter({ mode }).stream(REQUEST),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(mode);
      expect(textOf(events)).toBe("");
    },
  );
});
