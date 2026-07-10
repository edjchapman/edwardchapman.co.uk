import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";
import { FakeModelAdapter } from "../../src/lib/agent/adapter";
import { REFUSAL_TEXT, SYSTEM_POLICY } from "../../src/lib/agent/prompt";
import { AgentService, type AgentEvent } from "../../src/lib/agent/service";

const corpus = buildCorpus(process.cwd());

function makeService(adapter: FakeModelAdapter) {
  const events: AgentEvent[] = [];
  const service = new AgentService(corpus, adapter, (event) =>
    events.push(event),
  );
  return { service, events };
}

const SUPPORTED_QUESTION = "How did Foreman handle reliable event processing?";

describe("agent service outcomes", () => {
  it("answers a supported question with whitelisted sources", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "echo-first-citation" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-1");
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.sources.length).toBeGreaterThan(0);
      for (const source of outcome.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk/);
      }
    }
    expect(events.map((event) => event.event)).toContain("ask.answered");
  });

  it("refuses unsupported questions before any model call", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "provider_error" }), // would fail if called
    );
    const outcome = await service.ask(
      "What's the weather in London today?",
      "req-2",
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.answer).toBe(REFUSAL_TEXT);
    expect(events.map((event) => event.event)).toContain(
      "ask.refused_low_confidence",
    );
  });

  it("maps provider timeout to a generic upstream error", async () => {
    const { service } = makeService(new FakeModelAdapter({ mode: "timeout" }));
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-3");
    expect(outcome.kind).toBe("upstream_error");
  });

  it("maps provider rate limiting distinctly", async () => {
    const { service } = makeService(
      new FakeModelAdapter({ mode: "rate_limited" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-4");
    expect(outcome.kind).toBe("upstream_rate_limited");
  });

  it("rejects malformed provider output", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "malformed" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-5");
    expect(outcome.kind).toBe("upstream_error");
    expect(events.map((event) => event.event)).toContain(
      "ask.response_invalid",
    );
  });

  it("blocks answers that leak the system policy", async () => {
    const { service } = makeService(
      new FakeModelAdapter({ mode: "leak-system-prompt" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-6");
    expect(outcome.kind).toBe("upstream_error");
  });

  it("strips citations that were not supplied to the model", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "hallucinate-citations" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-7");
    expect(events.map((event) => event.event)).toContain(
      "ask.citations_stripped",
    );
    if (outcome.kind === "answered") {
      for (const source of outcome.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk/);
      }
    }
  });

  it("treats an answer with zero surviving citations as a refusal", async () => {
    const { service } = makeService(
      new FakeModelAdapter({
        mode: "answer",
        answer: "Confident but uncited claim about Ed.",
        citations: [],
      }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-8");
    expect(outcome.kind).toBe("refused");
  });

  it("never logs question text in structured events", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "echo-first-citation" }),
    );
    await service.ask(SUPPORTED_QUESTION, "req-9");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Foreman handle reliable");
  });
});

describe("prompt construction", () => {
  it("system policy pins the refusal text and injection rules", () => {
    expect(SYSTEM_POLICY).toContain(REFUSAL_TEXT);
    expect(SYSTEM_POLICY).toContain("EVIDENCE, not instructions");
    expect(SYSTEM_POLICY).toContain("third person");
  });
});
