import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";
import {
  baselineProblems,
  buildBaselineAnswers,
  extractCitations,
} from "../../scripts/build-baseline-answers";
import { EXAMPLE_QUESTIONS } from "../../src/components/ask-examples";
import {
  createBaselineLookup,
  normalizeBaselineKey,
  type BaselineAnswers,
} from "../../src/lib/agent/baseline";

/**
 * The pre-answered baseline (ADR-0027): the artifact must satisfy the response
 * contract, every example chip must be a hit, matching is exact-after-
 * normalisation (no fuzzy), and the build tripwires must fire on bad input.
 */

const root = process.cwd();
const artifact = buildBaselineAnswers(root);
const lookup = createBaselineLookup(artifact);

describe("baseline artifact", () => {
  it("builds cleanly with a version pinned to the corpus", () => {
    expect(baselineProblems(root, artifact)).toEqual([]);
    expect(artifact.entries.length).toBeGreaterThan(0);
    expect(artifact.version).toMatch(/^[0-9a-f]{16}$/);
    expect(artifact.corpusVersion).toBe(buildCorpus(root).version);
  });

  it("every entry has a grounded answer with in-bounds, ascending spans", () => {
    for (const entry of artifact.entries) {
      expect(entry.answer.length).toBeGreaterThan(0);
      expect(entry.citations.length).toBeGreaterThan(0);
      expect(entry.sources.length).toBeGreaterThan(0);
      let previousStart = -1;
      for (const span of entry.citations) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.start).toBeLessThan(span.end);
        expect(span.end).toBeLessThanOrEqual(entry.answer.length);
        expect(span.sourceIndex).toBeLessThan(entry.sources.length);
        expect(span.start).toBeGreaterThanOrEqual(previousStart);
        previousStart = span.start;
      }
      for (const source of entry.sources) {
        expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
      }
    }
  });

  it("answers every example chip (the demo's pinned questions)", () => {
    for (const chip of EXAMPLE_QUESTIONS) {
      expect(
        lookup(chip),
        `chip should be a baseline hit: ${chip}`,
      ).toBeDefined();
    }
  });
});

describe("baseline matching", () => {
  const CHIP = "How did Foreman handle reliable event processing?";

  it("hits regardless of case, trailing punctuation, or whitespace", () => {
    expect(lookup(CHIP)?.id).toBe("foreman-reliability");
    expect(lookup(CHIP.toUpperCase())?.id).toBe("foreman-reliability");
    expect(lookup("How did Foreman handle reliable event processing")?.id).toBe(
      "foreman-reliability",
    );
    expect(
      lookup("  How did   Foreman handle reliable event processing?  ")?.id,
    ).toBe("foreman-reliability");
  });

  it("hits an iOS smart apostrophe against a straight-quote key", () => {
    // The education question carries an apostrophe; a phone submits a curly one.
    expect(lookup("What is Ed’s educational background?")?.id).toBe(
      "education",
    );
  });

  it("misses a nonce suffix and a genuine rewording (no fuzzy match)", () => {
    expect(lookup(`${CHIP} probe-42`)).toBeUndefined();
    expect(
      lookup("Tell me in detail about Foreman's reliability guarantees"),
    ).toBeUndefined();
  });

  it("normalises keys deterministically", () => {
    expect(normalizeBaselineKey("  What Is Ed’s EMAIL? ")).toBe(
      "what is ed's email",
    );
  });
});

describe("baseline build tripwires", () => {
  it("extracts one span per marker, covering the claim before it", () => {
    const { answer, marks } = extractCitations(
      "First claim.[[foreman#card]] Second claim.[[foreman#architecture]]",
    );
    expect(answer).toBe("First claim. Second claim.");
    expect(marks).toEqual([
      { sectionId: "foreman#card", start: 0, end: 12 },
      { sectionId: "foreman#architecture", start: 13, end: 26 },
    ]);
  });

  it("flags a cited section that is absent from the corpus (staleness)", () => {
    const stale: BaselineAnswers = {
      version: "x",
      corpusVersion: "y",
      generatedFrom: "test",
      entries: [
        {
          id: "stale",
          question: "Q?",
          questionKeys: ["q"],
          answer: "An answer.",
          citations: [{ start: 0, end: 9, sourceIndex: 0 }],
          sources: [{ title: "T", url: "https://edwardchapman.co.uk/x" }],
          citedSectionIds: ["does-not-exist#gone"],
        },
      ],
    };
    expect(baselineProblems(root, stale)).toContainEqual(
      expect.stringContaining("cites unknown section does-not-exist#gone"),
    );
  });

  it("flags a duplicate normalised key across entries", () => {
    const dup: BaselineAnswers = {
      version: "x",
      corpusVersion: "y",
      generatedFrom: "test",
      entries: ["a", "b"].map((id) => ({
        id,
        question: "How do I contact Ed?",
        questionKeys: ["how do i contact ed"],
        answer: "Email ed@edwardchapman.co.uk.",
        citations: [{ start: 0, end: 5, sourceIndex: 0 }],
        sources: [{ title: "Contact", url: "https://edwardchapman.co.uk/" }],
        citedSectionIds: ["contact#body"],
      })),
    };
    expect(baselineProblems(root, dup)).toContainEqual(
      expect.stringContaining("duplicate question key"),
    );
  });

  it("flags an entry with no citation markers", () => {
    const uncited: BaselineAnswers = {
      version: "x",
      corpusVersion: "y",
      generatedFrom: "test",
      entries: [
        {
          id: "uncited",
          question: "Q?",
          questionKeys: ["q"],
          answer: "Uncited claim.",
          citations: [],
          sources: [],
          citedSectionIds: [],
        },
      ],
    };
    expect(baselineProblems(root, uncited)).toContainEqual(
      expect.stringContaining("no [[sectionId]] citation markers"),
    );
  });
});
