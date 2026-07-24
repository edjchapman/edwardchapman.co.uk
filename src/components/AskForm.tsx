import { useRef, useState, type FormEvent } from "react";

import { REFUSAL_TEXT } from "../lib/agent/refusal.ts";
import AskExchange, { type Exchange, type Source } from "./AskExchange.tsx";
import { type CitationSpan } from "./ask-citations.ts";

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
 *
 * Completed exchanges accumulate as a transcript (oldest first) above the
 * live region; the live region holds only the in-flight or most recent
 * state, so each finished answer is announced exactly once. A visitor can
 * stop an in-flight stream; the partial text is kept as a stopped exchange.
 */

type AskState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "streaming"; answer: string }
  | { phase: "answered"; exchange: Exchange }
  | { phase: "error"; message: string };

/** The wire events the streaming route emits (ADR-0016). */
type StreamEvent =
  | { kind: "answer_delta"; text: string }
  | { kind: "answered"; citations?: CitationSpan[]; sources?: Source[] }
  | { kind: "refused"; answer: string }
  | { kind: "upstream_error" }
  | { kind: "upstream_rate_limited" };

// Golden-fixture phrasings where one exists (retrieval is pinned to answer
// them); the career and education questions use their goldens' verbatim
// wording.
const EXAMPLE_QUESTIONS = [
  "What kind of engineering roles is Ed best suited to?",
  "Where has Ed worked, and when?",
  "What is Ed's educational background?",
  "How did Foreman handle reliable event processing?",
  "What does Ed mean by evaluation-driven AI engineering?",
];

// Mirror the server's user-facing copy for the terminal error events, which
// carry a kind but no message (the buffered path surfaces the JSON envelope's).
const RATE_LIMITED_MESSAGE =
  "Too many questions right now — please try again in a minute.";
const UPSTREAM_ERROR_MESSAGE =
  "The answer service had a problem. Nothing you did — try again shortly.";

const MAX_QUESTION_LENGTH = 500;
const COUNTER_FROM = 400;

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Map a terminal stream event to its finished state; null for deltas. */
function terminalState(
  event: StreamEvent,
  answer: string,
  asked: string,
): AskState | null {
  switch (event.kind) {
    case "answer_delta":
      return null;
    case "answered":
      return {
        phase: "answered",
        exchange: {
          question: asked,
          answer,
          citations: event.citations ?? [],
          sources: event.sources ?? [],
          refused: false,
          stopped: false,
        },
      };
    case "refused":
      return {
        phase: "answered",
        exchange: {
          question: asked,
          answer: event.answer,
          citations: [],
          sources: [],
          refused: true,
          stopped: false,
        },
      };
    case "upstream_rate_limited":
      return { phase: "error", message: RATE_LIMITED_MESSAGE };
    case "upstream_error":
      return { phase: "error", message: UPSTREAM_ERROR_MESSAGE };
  }
}

export default function AskForm() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const [history, setHistory] = useState<Exchange[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = state.phase === "loading" || state.phase === "streaming";

  function finishWith(next: AskState) {
    setState(next);
    inputRef.current?.focus();
  }

  /** Archive the visible answer before the next question replaces it. */
  function archiveCurrent() {
    if (state.phase === "answered") {
      const current = state.exchange;
      setHistory((entries) => [...entries, current]);
    }
  }

  async function consumeStream(
    body: ReadableStream<Uint8Array>,
    asked: string,
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    const stoppedExchange = (): Exchange => ({
      question: asked,
      answer,
      citations: [],
      sources: [],
      refused: false,
      stopped: true,
    });

    try {
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

          if (event.kind === "answer_delta") {
            answer += event.text;
            setState({ phase: "streaming", answer });
            continue;
          }
          finishWith(terminalState(event, answer, asked) ?? { phase: "idle" });
          return;
        }
      }
    } catch (error) {
      // The visitor pressed Stop mid-stream: keep the partial text.
      if (!isAbortError(error)) throw error;
      finishWith({ phase: "answered", exchange: stoppedExchange() });
      return;
    }
    // The stream ended without a terminal event (stopped, or the connection
    // died): finalise rather than staying busy forever.
    finishWith({ phase: "answered", exchange: stoppedExchange() });
  }

  async function submit(text: string) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0 || busy) return;
    archiveCurrent();
    setState({ phase: "loading" });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok) {
        finishWith({ phase: "error", message: await errorMessage(response) });
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (response.body && contentType.includes("text/event-stream")) {
        await consumeStream(response.body, trimmed);
        return;
      }

      // Buffered fallback: a JSON answer (mocked tests, or a non-streaming
      // backend). Refusals arrive here too — answer with empty sources.
      const body = (await response.json()) as {
        answer: string;
        citations?: CitationSpan[];
        sources?: Source[];
      };
      finishWith({
        phase: "answered",
        exchange: {
          question: trimmed,
          answer: body.answer,
          citations: body.citations ?? [],
          sources: body.sources ?? [],
          refused: body.answer === REFUSAL_TEXT,
          stopped: false,
        },
      });
    } catch (error) {
      // Stopped before any answer arrived: return quietly to the form.
      if (isAbortError(error)) {
        finishWith({ phase: "idle" });
        return;
      }
      finishWith({
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
            maxLength={MAX_QUESTION_LENGTH}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. How did Foreman handle reliable event processing?"
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </button>
          {busy && (
            <button
              type="button"
              className="stop"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          )}
        </div>
        {question.length >= COUNTER_FROM && (
          <p className="counter" aria-live="polite">
            {question.length}/{MAX_QUESTION_LENGTH}
          </p>
        )}
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

      {history.length > 0 && (
        <div className="transcript" aria-label="Earlier answers">
          {history.map((exchange, index) => (
            <AskExchange
              key={index}
              exchange={exchange}
              index={index}
              showQuestion
            />
          ))}
        </div>
      )}

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
          <AskExchange
            exchange={state.exchange}
            index={history.length}
            showQuestion={history.length > 0}
          />
        )}
      </div>
    </div>
  );
}
