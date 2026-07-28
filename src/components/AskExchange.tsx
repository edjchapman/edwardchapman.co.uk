import { Fragment } from "react";

import { segmentAnswer, type CitationSpan } from "./ask-citations.ts";

/**
 * One completed question/answer exchange (AskForm renders a transcript of
 * these). Source anchors are namespaced by exchange index so two answers'
 * citation lists never collide in the same document.
 */

export type Source = { title: string; url: string };

export interface Exchange {
  question: string;
  answer: string;
  citations: CitationSpan[];
  sources: Source[];
  refused: boolean;
  /** True when the visitor stopped the stream before the terminal event. */
  stopped: boolean;
  /** True when served from the pre-answered baseline, not the model (ADR-0027). */
  baseline: boolean;
}

interface AskExchangeProps {
  exchange: Exchange;
  index: number;
  /** Echo the question above the answer (transcript context). */
  showQuestion: boolean;
}

export default function AskExchange({
  exchange,
  index,
  showQuestion,
}: AskExchangeProps) {
  const anchor = (marker: number) => `ask-source-${index}-${marker}`;
  return (
    <div className="answer">
      {showQuestion && <p className="asked">{exchange.question}</p>}
      <p>
        {segmentAnswer(
          exchange.answer,
          exchange.citations,
          exchange.sources.length,
        ).map((segment, segmentIndex) => (
          <Fragment key={segmentIndex}>
            {segment.text}
            {segment.markers.map((marker) => (
              <sup key={marker} className="citation">
                <a
                  href={`#${anchor(marker)}`}
                  aria-label={`Source ${marker}: ${exchange.sources[marker - 1]?.title ?? ""}`}
                >
                  [{marker}]
                </a>
              </sup>
            ))}
          </Fragment>
        ))}
      </p>
      {exchange.sources.length > 0 && (
        <>
          <p className="sources-label">Sources on this site:</p>
          <ol className="sources">
            {exchange.sources.map((source, sourceIndex) => (
              <li key={source.url} id={anchor(sourceIndex + 1)}>
                <a href={source.url}>{source.title}</a>
              </li>
            ))}
          </ol>
        </>
      )}
      {exchange.refused && (
        <p className="pointer">
          Nothing published on this site covers that. For technology questions,
          the <a href="/experience">experience page</a> lists what Ed has
          published about his stack and how long he's used it.
        </p>
      )}
      <p className="disclosure">
        {exchange.stopped
          ? "Stopped early — sources unavailable for a partial answer."
          : exchange.baseline
            ? "A pre-written answer from published site content — prepared and reviewed in advance, and it isn't Ed speaking."
            : "Generated from published site content — it may be imperfect, and it isn't Ed speaking."}
      </p>
    </div>
  );
}
