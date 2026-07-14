/**
 * Pure citation-rendering helper for the ask island: turns the API's span
 * contract ({start, end, sourceIndex} over the answer string) into
 * renderable segments with 1-based source markers. Index arithmetic over
 * plain text only — the model's output is never treated as markup.
 */

export type CitationSpan = { start: number; end: number; sourceIndex: number };

export type AnswerSegment = {
  text: string;
  /** 1-based source numbers rendered after this segment. */
  markers: number[];
};

function isRenderable(
  citation: CitationSpan,
  answerLength: number,
  sourceCount: number,
): boolean {
  return (
    Number.isInteger(citation.start) &&
    Number.isInteger(citation.end) &&
    Number.isInteger(citation.sourceIndex) &&
    citation.start >= 0 &&
    citation.start < citation.end &&
    citation.end <= answerLength &&
    citation.sourceIndex >= 0 &&
    citation.sourceIndex < sourceCount
  );
}

/**
 * Segments tile the whole answer; each segment ends where one or more
 * citations end, carrying the deduplicated, sorted markers for them. The
 * server guarantees the invariants; the client still filters defensively.
 */
export function segmentAnswer(
  answer: string,
  citations: CitationSpan[],
  sourceCount: number,
): AnswerSegment[] {
  const markersByEnd = new Map<number, Set<number>>();
  for (const citation of citations) {
    if (!isRenderable(citation, answer.length, sourceCount)) continue;
    const markers = markersByEnd.get(citation.end) ?? new Set<number>();
    markers.add(citation.sourceIndex + 1);
    markersByEnd.set(citation.end, markers);
  }
  if (markersByEnd.size === 0) return [{ text: answer, markers: [] }];

  const boundaries = [...markersByEnd.keys()].sort((a, b) => a - b);
  const segments: AnswerSegment[] = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    segments.push({
      text: answer.slice(cursor, boundary),
      markers: [...(markersByEnd.get(boundary) ?? [])].sort((a, b) => a - b),
    });
    cursor = boundary;
  }
  if (cursor < answer.length) {
    segments.push({ text: answer.slice(cursor), markers: [] });
  }
  return segments;
}
