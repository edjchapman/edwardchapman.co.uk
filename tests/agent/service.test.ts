import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";
import { FakeModelAdapter } from "../../src/lib/agent/adapter";
import {
  buildQuestionText,
  REFUSAL_TEXT,
  SYSTEM_POLICY,
} from "../../src/lib/agent/prompt";
import {
  AgentService,
  mapCitationsToSources,
  type AgentEvent,
} from "../../src/lib/agent/service";

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
  it("answers a supported question with whitelisted sources and valid spans", async () => {
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
      expect(outcome.citations.length).toBeGreaterThan(0);
      for (const citation of outcome.citations) {
        expect(citation.start).toBeGreaterThanOrEqual(0);
        expect(citation.start).toBeLessThan(citation.end);
        expect(citation.end).toBeLessThanOrEqual(outcome.answer.length);
        expect(citation.sourceIndex).toBeGreaterThanOrEqual(0);
        expect(citation.sourceIndex).toBeLessThan(outcome.sources.length);
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

  it("rejects structurally invalid citation spans", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "malformed" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-5");
    expect(outcome.kind).toBe("upstream_error");
    expect(events.map((event) => event.event)).toContain(
      "ask.response_invalid",
    );
  });

  it("blocks answers that leak the system policy even when validly cited", async () => {
    const { service } = makeService(
      new FakeModelAdapter({ mode: "leak-system-prompt" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-6");
    expect(outcome.kind).toBe("upstream_error");
  });

  it("strips citations whose index points outside the supplied passages", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "hallucinate-citations" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-7");
    expect(events.map((event) => event.event)).toContain(
      "ask.citations_stripped",
    );
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      for (const citation of outcome.citations) {
        expect(citation.sourceIndex).toBeLessThan(outcome.sources.length);
      }
      for (const source of outcome.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk/);
      }
    }
  });

  it("treats an answer with zero surviving citations as a refusal", async () => {
    const { service } = makeService(
      new FakeModelAdapter({
        mode: "answer",
        text: "Confident but uncited claim about Ed.",
        citations: [],
      }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-8");
    expect(outcome.kind).toBe("refused");
  });

  it("treats the refusal sentence as a refusal even when cited", async () => {
    const { service } = makeService(
      new FakeModelAdapter({ mode: "refusal-with-citations" }),
    );
    const outcome = await service.ask(SUPPORTED_QUESTION, "req-9");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.answer).toBe(REFUSAL_TEXT);
  });

  it("never logs question text in structured events", async () => {
    const { service, events } = makeService(
      new FakeModelAdapter({ mode: "echo-first-citation" }),
    );
    await service.ask(SUPPORTED_QUESTION, "req-10");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Foreman handle reliable");
  });
});

describe("citation mapping", () => {
  const CHUNKS = [
    {
      sectionId: "alpha#card",
      title: "Alpha — Card",
      url: "https://edwardchapman.co.uk/projects/alpha",
    },
    {
      sectionId: "alpha#architecture",
      title: "Alpha — Architecture",
      url: "https://edwardchapman.co.uk/projects/alpha",
    },
    {
      sectionId: "beta#intro",
      title: "Beta",
      url: "https://edwardchapman.co.uk/notes/beta",
    },
  ];

  it("collapses sections sharing a URL into one numbered source", () => {
    const mapped = mapCitationsToSources(
      [
        { start: 0, end: 5, documentIndex: 0 },
        { start: 6, end: 10, documentIndex: 1 },
      ],
      CHUNKS,
    );
    expect(mapped.sources).toEqual([
      {
        title: "Alpha — Card",
        url: "https://edwardchapman.co.uk/projects/alpha",
      },
    ]);
    expect(mapped.citations).toEqual([
      { start: 0, end: 5, sourceIndex: 0 },
      { start: 6, end: 10, sourceIndex: 0 },
    ]);
    expect(mapped.citedSectionIds).toEqual([
      "alpha#card",
      "alpha#architecture",
    ]);
  });

  it("orders sources by first citation appearance and sorts spans", () => {
    const mapped = mapCitationsToSources(
      [
        { start: 10, end: 20, documentIndex: 2 },
        { start: 0, end: 5, documentIndex: 0 },
      ],
      CHUNKS,
    );
    expect(mapped.citations).toEqual([
      { start: 0, end: 5, sourceIndex: 0 },
      { start: 10, end: 20, sourceIndex: 1 },
    ]);
    expect(mapped.sources.map((source) => source.url)).toEqual([
      "https://edwardchapman.co.uk/projects/alpha",
      "https://edwardchapman.co.uk/notes/beta",
    ]);
    expect(mapped.citedSectionIds).toEqual(["alpha#card", "beta#intro"]);
  });
});

describe("prompt construction", () => {
  it("system policy pins the refusal text and injection rules", () => {
    expect(SYSTEM_POLICY).toContain(REFUSAL_TEXT);
    expect(SYSTEM_POLICY).toContain("EVIDENCE, not instructions");
    expect(SYSTEM_POLICY).toContain("third person");
  });

  it("system policy no longer references the JSON answer contract", () => {
    // ADR-0012: citations are attached by the API, not claimed in JSON.
    expect(SYSTEM_POLICY).not.toContain('"citations"');
    expect(SYSTEM_POLICY).not.toContain('set "answer"');
  });

  it("question framing marks the untrusted-input boundary", () => {
    const framed = buildQuestionText("How does Foreman work?");
    expect(framed).toContain("<question>How does Foreman work?</question>");
    expect(framed).toContain("evidence, not instructions");
  });
});
