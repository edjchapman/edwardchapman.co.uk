import { Fragment, useRef, useState, type FormEvent } from "react";

import { segmentAnswer, type CitationSpan } from "./ask-citations.ts";

/**
 * The site's one React island (ADR-0004): the ask form's state machine —
 * idle / loading / streaming / answered / error — with screen-reader status
 * announcements. Everything else on the site is plain HTML.
 *
 * Answers stream token-by-token (ADR-0016): the client asks for
 * `text/event-stream` and renders `answer_delta`s as they arrive, finalising
 * inline citations + sources on the terminal event. It stays dual-mode — a
 * plain JSON response (an error envelope, or a non-streaming backend) is
 * handled by the buffered path — so no-JS, tests, and probes are unaffected.
 */

type Source = { title: string; url: string };

type AskState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "streaming"; answer: string }
  | {
      phase: "answered";
      answer: string;
      citations: CitationSpan[];
      sources: Source[];
    }
  | { phase: "error"; message: string };

/** The wire events the streaming route emits (ADR-0016). */
type StreamEvent =
  | { kind: "answer_delta"; text: string }
  | { kind: "answered"; citations?: CitationSpan[]; sources?: Source[] }
  | { kind: "refused"; answer: string }
  | { kind: "upstream_error" }
  | { kind: "upstream_rate_limited" };

// Golden-fixture phrasings where one exists (retrieval is pinned to answer
// them); the career question uses work-history's verbatim wording.
const EXAMPLE_QUESTIONS = [
  "What kind of engineering roles is Ed best suited to?",
  "Where has Ed worked, and when?",
  "How did Foreman handle reliable event processing?",
  "What does Ed mean by evaluation-driven AI engineering?",
  "How does Ed approach AI-assisted software delivery?",
];

// Mirror the server's user-facing copy for the terminal error events, which
// carry a kind but no message (the buffered path surfaces the JSON envelope's).
const RATE_LIMITED_MESSAGE =
  "Too many questions right now — please try again in a minute.";
const UPSTREAM_ERROR_MESSAGE =
  "The answer service had a problem. Nothing you did — try again shortly.";

function parseStreamEvent(block: string): StreamEvent | null {
  const line = block.split("\n").find((entry) => entry.startsWith("data:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(":") + 1)) as StreamEvent;
  } catch {
    return null;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  } catch {
    /* non-JSON body — fall through to the generic message */
  }
  return "Something went wrong — please try again shortly.";
}

export default function AskForm() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.phase === "loading" || state.phase === "streaming";

  async function consumeStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const event = parseStreamEvent(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
        if (!event) continue;

        switch (event.kind) {
          case "answer_delta":
            answer += event.text;
            setState({ phase: "streaming", answer });
            break;
          case "answered":
            setState({
              phase: "answered",
              answer,
              citations: event.citations ?? [],
              sources: event.sources ?? [],
            });
            return;
          case "refused":
            setState({
              phase: "answered",
              answer: event.answer,
              citations: [],
              sources: [],
            });
            return;
          case "upstream_rate_limited":
            setState({ phase: "error", message: RATE_LIMITED_MESSAGE });
            return;
          case "upstream_error":
            setState({ phase: "error", message: UPSTREAM_ERROR_MESSAGE });
            return;
        }
      }
    }
  }

  async function submit(text: string) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0 || busy) return;
    setState({ phase: "loading" });

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        setState({ phase: "error", message: await errorMessage(response) });
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (response.body && contentType.includes("text/event-stream")) {
        await consumeStream(response.body);
        return;
      }

      // Buffered fallback: a JSON answer (mocked tests, or a non-streaming
      // backend). Refusals arrive here too — answer with empty sources.
      const body = (await response.json()) as {
        answer: string;
        citations?: CitationSpan[];
        sources?: Source[];
      };
      setState({
        phase: "answered",
        answer: body.answer,
        citations: body.citations ?? [],
        sources: body.sources ?? [],
      });
    } catch {
      setState({
        phase: "error",
        message: "The request didn't complete — please try again.",
      });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(question);
  }

  function askExample(example: string) {
    setQuestion(example);
    inputRef.current?.focus();
    void submit(example);
  }

  return (
    <div className="ask">
      <form onSubmit={onSubmit}>
        <label htmlFor="ask-question">Your question</label>
        <div className="row">
          <input
            id="ask-question"
            ref={inputRef}
            type="text"
            name="question"
            maxLength={500}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. How did Foreman handle reliable event processing?"
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>

      <p className="examples-label" id="ask-examples-label">
        Or try one of these:
      </p>
      <ul className="examples" aria-labelledby="ask-examples-label">
        {EXAMPLE_QUESTIONS.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => askExample(example)}
              disabled={busy}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>

      {/* aria-busy holds the screen-reader announcement until streaming ends,
          so the finished answer is read once, not per token. */}
      <div className="status" role="status" aria-live="polite" aria-busy={busy}>
        {state.phase === "loading" && (
          <p>Looking through the published pages…</p>
        )}
        {state.phase === "error" && <p className="error">{state.message}</p>}
        {state.phase === "streaming" && (
          <div className="answer">
            <p>{state.answer}</p>
          </div>
        )}
        {state.phase === "answered" && (
          <div className="answer">
            <p>
              {segmentAnswer(
                state.answer,
                state.citations,
                state.sources.length,
              ).map((segment, index) => (
                <Fragment key={index}>
                  {segment.text}
                  {segment.markers.map((marker) => (
                    <sup key={marker} className="citation">
                      <a
                        href={`#ask-source-${marker}`}
                        aria-label={`Source ${marker}: ${state.sources[marker - 1]?.title ?? ""}`}
                      >
                        [{marker}]
                      </a>
                    </sup>
                  ))}
                </Fragment>
              ))}
            </p>
            {state.sources.length > 0 && (
              <>
                <p className="sources-label">Sources on this site:</p>
                <ol className="sources">
                  {state.sources.map((source, index) => (
                    <li key={source.url} id={`ask-source-${index + 1}`}>
                      <a href={source.url}>{source.title}</a>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p className="disclosure">
              Generated from published site content — it may be imperfect, and
              it isn't Ed speaking.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
