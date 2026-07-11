import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";
import {
  CONFIDENCE_THRESHOLD,
  isConfident,
  LexicalRetriever,
} from "../../src/lib/agent/retrieval";

type RetrievalCases = {
  cases: {
    id: string;
    query: string;
    expectedSectionIds: string[];
    mayRefuse?: boolean;
  }[];
  refusals: { id: string; query: string }[];
};

const fixtures: RetrievalCases = JSON.parse(
  readFileSync(join(process.cwd(), "tests/agent/retrieval-cases.json"), "utf8"),
);

const corpus = buildCorpus(process.cwd());
const retriever = new LexicalRetriever(corpus.chunks);
const TOP_K = 5;

describe("golden retrieval cases", () => {
  for (const testCase of fixtures.cases) {
    it(`${testCase.id}: expected section in top-${TOP_K}`, () => {
      const results = retriever.search(testCase.query, TOP_K);
      const ids = results.map(({ chunk }) => chunk.sectionId);
      const hit = testCase.expectedSectionIds.some((expected) =>
        ids.includes(expected),
      );
      if (testCase.mayRefuse && !isConfident(results)) {
        expect(isConfident(results)).toBe(false); // acceptable refusal
        return;
      }
      expect(
        hit,
        `expected one of ${testCase.expectedSectionIds.join(", ")} in [${ids.join(", ")}]`,
      ).toBe(true);
      expect(isConfident(results)).toBe(true);
    });
  }
});

describe("refusal routing", () => {
  for (const refusal of fixtures.refusals) {
    it(`${refusal.id}: falls below the confidence threshold`, () => {
      const results = retriever.search(refusal.query, TOP_K);
      expect(
        isConfident(results),
        `top score ${results[0]?.score ?? 0} vs threshold ${CONFIDENCE_THRESHOLD}`,
      ).toBe(false);
    });
  }
});

describe("retrieval determinism", () => {
  it("identical queries produce identical rankings", () => {
    const a = retriever.search("transactional outbox reliability", TOP_K);
    const b = retriever.search("transactional outbox reliability", TOP_K);
    expect(a.map(({ chunk }) => chunk.sectionId)).toEqual(
      b.map(({ chunk }) => chunk.sectionId),
    );
  });
});
