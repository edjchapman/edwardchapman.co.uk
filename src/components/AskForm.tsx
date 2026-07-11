import { useRef, useState, type FormEvent } from "react";

/**
 * The site's one React island (ADR-0004): the ask form's state machine —
 * idle / loading / answered / refused / error — with screen-reader status
 * announcements. Everything else on the site is plain HTML.
 */

type Source = { title: string; url: string };

type AskState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "answered"; answer: string; sources: Source[] }
  | { phase: "error"; message: string };

const EXAMPLE_QUESTIONS = [
  "What kind of engineering roles is Ed best suited to?",
  "How did Foreman handle reliable event processing?",
  "What does Ed mean by evaluation-driven AI engineering?",
  "How does Ed approach AI-assisted software delivery?",
];

export default function AskForm() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(text: string) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0 || state.phase === "loading") return;
    setState({ phase: "loading" });

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof (body as { error: { message?: unknown } }).error.message ===
            "string"
            ? (body as { error: { message: string } }).error.message
            : "Something went wrong — please try again shortly.";
        setState({ phase: "error", message });
        return;
      }

      const ok = body as { answer: string; sources: Source[] };
      setState({
        phase: "answered",
        answer: ok.answer,
        sources: ok.sources ?? [],
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
            disabled={state.phase === "loading"}
          />
          <button type="submit" disabled={state.phase === "loading"}>
            {state.phase === "loading" ? "Asking…" : "Ask"}
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
              disabled={state.phase === "loading"}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>

      <div className="status" role="status" aria-live="polite">
        {state.phase === "loading" && (
          <p>Looking through the published pages…</p>
        )}
        {state.phase === "error" && <p className="error">{state.message}</p>}
        {state.phase === "answered" && (
          <div className="answer">
            <p>{state.answer}</p>
            {state.sources.length > 0 && (
              <>
                <p className="sources-label">Sources on this site:</p>
                <ul className="sources">
                  {state.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url}>{source.title}</a>
                    </li>
                  ))}
                </ul>
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
