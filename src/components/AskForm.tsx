import { useRef, useState, type FormEvent } from "react";

import { REFUSAL_TEXT } from "../lib/agent/refusal.ts";
import AskExchange, { type Exchange, type Source } from "./AskExchange.tsx";
import { type CitationSpan } from "./ask-citations.ts";
import {
  type AskState,
  errorMessage,
  isAbortError,
  NETWORK_ERROR_MESSAGE,
  parseStreamEvent,
  terminalState,
  transientError,
} from "./ask-stream.ts";

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
 * A watchdog fails a stalled request rather than leaving the form hung
 * (ADR-0026); the error phase distinguishes a transient blip from an
 * operator-actionable outage (`offline`).
 */

// Golden-fixture phrasings where one exists (retrieval is pinned to answer
// them); the career and education questions use their goldens' verbatim
// wording.
export const EXAMPLE_QUESTIONS = [
  "What kind of engineering roles is Ed best suited to?",
  "Where has Ed worked, and when?",
  "Is Ed open to contract or permanent roles?",
  "What is Ed's educational background?",
  "How did Foreman handle reliable event processing?",
  "What does Ed mean by evaluation-driven AI engineering?",
];

const MAX_QUESTION_LENGTH = 500;
const COUNTER_FROM = 400;
// Longer than the server's worst case (20s adapter timeout + one SDK retry):
// this only fires when the request is genuinely stuck, so the visitor gets an
// error instead of an indefinitely-disabled form.
const WATCHDOG_MS = 60_000;

export default function AskForm() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const [history, setHistory] = useState<Exchange[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Distinguishes a watchdog-triggered abort (→ error) from the visitor
  // pressing Stop (→ quiet idle / kept partial).
  const watchdogRef = useRef(false);
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
      baseline: false,
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
          // Unknown terminal kinds resolve to the transient error, never a
          // silent idle that leaves the form looking hung (ADR-0026).
          finishWith(terminalState(event, answer, asked) ?? transientError());
          return;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) throw error;
      // The watchdog fired mid-stream: a stalled request, not a visitor Stop.
      if (watchdogRef.current) {
        finishWith({
          phase: "error",
          message: NETWORK_ERROR_MESSAGE,
          offline: false,
        });
        return;
      }
      // The visitor pressed Stop mid-stream: keep the partial text.
      finishWith({ phase: "answered", exchange: stoppedExchange() });
      return;
    }
    // The stream ended without a terminal event. With no text at all the
    // connection died before answering — surface an error rather than an empty
    // "stopped" card; with partial text, keep it as a stopped exchange.
    if (answer === "") {
      finishWith(transientError());
      return;
    }
    finishWith({ phase: "answered", exchange: stoppedExchange() });
  }

  async function submit(text: string) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0 || busy) return;
    archiveCurrent();
    setState({ phase: "loading" });
    const controller = new AbortController();
    abortRef.current = controller;
    watchdogRef.current = false;
    const watchdog = setTimeout(() => {
      watchdogRef.current = true;
      controller.abort();
    }, WATCHDOG_MS);

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
        const { message, code } = await errorMessage(response);
        finishWith({
          phase: "error",
          message,
          offline: code === "upstream_unavailable",
        });
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (response.body && contentType.includes("text/event-stream")) {
        await consumeStream(response.body, trimmed);
        return;
      }

      // Buffered fallback: a JSON answer (mocked tests, a non-streaming
      // backend, or a pre-answered baseline hit). Refusals arrive here too —
      // answer with empty sources. `served: "baseline"` drives the distinct
      // disclosure line (ADR-0027).
      const body = (await response.json()) as {
        answer: string;
        citations?: CitationSpan[];
        sources?: Source[];
        served?: "model" | "baseline";
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
          baseline: body.served === "baseline",
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        // Watchdog abort before any response: a stalled request. A visitor
        // Stop before any response returns quietly to the form.
        if (watchdogRef.current) {
          finishWith({
            phase: "error",
            message: NETWORK_ERROR_MESSAGE,
            offline: false,
          });
          return;
        }
        finishWith({ phase: "idle" });
        return;
      }
      finishWith({
        phase: "error",
        message: NETWORK_ERROR_MESSAGE,
        offline: false,
      });
    } finally {
      clearTimeout(watchdog);
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
        {state.phase === "error" && (
          <>
            <p className="error">{state.message}</p>
            {state.offline && (
              <p className="pointer">
                The published pages cover the same ground — start with the{" "}
                <a href="/experience">experience page</a> or the{" "}
                <a href="/projects">projects</a>.
              </p>
            )}
          </>
        )}
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
