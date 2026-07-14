import { describe, expect, it } from "vitest";

import {
  segmentAnswer,
  type CitationSpan,
} from "../../src/components/ask-citations";

const ANSWER = "Hello world."; // length 12

function joinSegments(segments: { text: string }[]): string {
  return segments.map((segment) => segment.text).join("");
}

describe("segmentAnswer", () => {
  it("splits at a mid-answer citation boundary with a 1-based marker", () => {
    const segments = segmentAnswer(
      ANSWER,
      [{ start: 0, end: 5, sourceIndex: 0 }],
      1,
    );
    expect(segments).toEqual([
      { text: "Hello", markers: [1] },
      { text: " world.", markers: [] },
    ]);
  });

  it("renders sorted multi-source markers at a shared boundary", () => {
    const citations: CitationSpan[] = [
      { start: 0, end: 5, sourceIndex: 1 },
      { start: 0, end: 5, sourceIndex: 0 },
    ];
    const segments = segmentAnswer(ANSWER, citations, 2);
    expect(segments[0]).toEqual({ text: "Hello", markers: [1, 2] });
  });

  it("deduplicates identical markers at one boundary", () => {
    const citations: CitationSpan[] = [
      { start: 0, end: 5, sourceIndex: 0 },
      { start: 2, end: 5, sourceIndex: 0 },
    ];
    const segments = segmentAnswer(ANSWER, citations, 1);
    expect(segments[0]).toEqual({ text: "Hello", markers: [1] });
  });

  it("ignores citations that fall outside the answer or the sources", () => {
    const citations: CitationSpan[] = [
      { start: 0, end: 50, sourceIndex: 0 }, // beyond answer length
      { start: 5, end: 2, sourceIndex: 0 }, // inverted span
      { start: 0, end: 5, sourceIndex: 7 }, // beyond source count
    ];
    expect(segmentAnswer(ANSWER, citations, 1)).toEqual([
      { text: ANSWER, markers: [] },
    ]);
  });

  it("returns the whole answer as one segment when uncited", () => {
    expect(segmentAnswer(ANSWER, [], 0)).toEqual([
      { text: ANSWER, markers: [] },
    ]);
  });

  it("handles a boundary at the very end of the answer", () => {
    const segments = segmentAnswer(
      ANSWER,
      [{ start: 6, end: 12, sourceIndex: 0 }],
      1,
    );
    expect(segments).toEqual([{ text: ANSWER, markers: [1] }]);
  });

  it("always tiles the full answer", () => {
    const citations: CitationSpan[] = [
      { start: 0, end: 5, sourceIndex: 0 },
      { start: 6, end: 11, sourceIndex: 1 },
    ];
    expect(joinSegments(segmentAnswer(ANSWER, citations, 2))).toBe(ANSWER);
  });
});
