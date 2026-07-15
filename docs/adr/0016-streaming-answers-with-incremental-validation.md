# ADR-0016: Streaming answers with incremental output-control validation

**Status:** Accepted (2026-07-15)

## Context

Streaming the answer token-by-token is the single most visible signal of
LLM-API fluency and the biggest perceived-latency win for `/ask` — the answer
appears as it is written rather than after a 2–4 s silence. It is listed as
possible work under the spec's "Phase 5 — measured improvements" (not a
pre-authorised requirement) and is now being adopted deliberately.

ADR-0012 explicitly **rejected** streaming: _"the service validates the
complete answer (structural schema, citation whitelist, leak fingerprints,
refusal detection) before a byte reaches the client (spec §10 output controls).
Streaming would emit text ahead of validation; buffering server-side until
validation completes is not streaming."_ That reasoning is correct and the
output controls are load-bearing (spec §10): answer only from supplied context,
avoid unsupported claims, never reveal the system prompt, never improvise after
retrieval-confidence fails. Adopting streaming therefore cannot mean dropping
those guarantees — it means moving them from **whole-answer** validation to
**incremental** validation that upholds the same invariants as text flows.

Two invariants are the hard ones under streaming:

- **Grounding** — an answer with zero API-attached citations is refused, not
  shown (spec §10; ADR-0012). A naive stream reveals ungrounded prose before
  that verdict exists.
- **Prompt/leak safety** — the response must not reveal the system policy. A
  naive stream emits a leaking span before any scan runs.

## Decision

Add a streamed response path that preserves every spec §10 output control by
validating incrementally. The two hard invariants are held by two mechanisms:

- **Grounding buffer.** Retrieved passages travel as `search_result` blocks with
  citations enabled (ADR-0012), so the API interleaves `citation` events with
  text as it generates. The server **withholds all emitted text until the first
  valid citation arrives**, then flushes the buffer and streams the remainder
  live. If the stream ends having produced **zero** citations, nothing was ever
  revealed and the server emits the refusal sentence instead. This upholds
  "zero citations ⇒ refuse" exactly, at the cost of buffering only the
  pre-first-citation prefix (small for a grounded answer).
- **Leak-scan with tail hold-back.** The accumulating answer buffer is scanned
  for the policy-leak fingerprints on every delta. To catch a fingerprint that
  straddles a chunk boundary, the server holds back a tail equal to the longest
  fingerprint and never emits it until more text or the stream end confirms it
  is clean — so a fingerprint is always detected **before its final character
  is emitted**. A hit aborts the stream (error event) rather than emitting.

The remaining controls are unchanged: the **confidence gate refuses
pre-model**, so a low-confidence question never opens a stream at all; the
**refusal sentence** streams normally when the model declines (it is benign to
show); **citations and sources** are delivered as a terminal structured event
and rendered by the existing `segmentAnswer` inline-marker code. The streamed
wire contract is a typed event sequence — `text` deltas → `citations` →
`done | refused | error` — each carrying the guarantees the buffered envelope
carries today.

The buffered `POST /api/ask` JSON path is **retained**, not replaced: it is the
no-JavaScript fallback and the surface the deploy smoke and `uptime-ask` monitor
probe. Streaming is an additive, progressively-enhanced path for JS clients.

## Alternatives considered

- **Buffer server-side, then "typewriter"-replay to the client.** Rejected —
  this is ADR-0012's exact point: validating the whole answer then revealing it
  slowly is not streaming; it adds latency to fake an effect and wins nothing
  real.
- **Stream raw model output, redact on the client.** Rejected — the client is
  not the trust boundary; leaked bytes have already left the server, and an
  ungrounded prefix has already been shown. Validation must stay server-side.
- **Stream with no grounding buffer** (emit text immediately, refuse at the end
  if uncited). Rejected — it shows ungrounded prose the current design refuses,
  violating spec §10 "avoid unsupported claims / do not improvise."
- **Keep non-streaming only** (status quo). The showcase and UX goals justify
  the change; retained as the fallback path rather than the only path.

## Relations

Supersedes the "Streaming responses — Rejected" alternative in ADR-0012; the
rest of ADR-0012 stands and is in fact a **prerequisite** — API-attached
citations are what make the grounding buffer possible (the server learns a span
is grounded mid-stream). Realizes the spec's Phase-5 "streaming answers" item
and annotates spec §10: validation is now incremental, not whole-answer, with
the same guarantees. Complements ADR-0004 (the `/ask` React island is the only
place hydration is justified; streaming lives there).

## Consequences

- Token-by-token UX for JS clients; the buffered JSON path remains for no-JS and
  for the health probes, so monitoring is unaffected.
- Safety is preserved by construction: an ungrounded answer is never revealed
  (grounding buffer), and a policy-leak is caught before its final byte ships
  (tail hold-back). These are weaker than "validate the whole answer first" only
  in that they act per-delta — but they enforce the same spec §10 outcomes.
- New surface to build and test: a streaming adapter method, a streaming Worker
  route emitting the typed event sequence, progressive rendering in `AskForm`,
  and a **streaming fake adapter** so the deterministic suite exercises the
  event sequence, the grounding-buffer refusal, and the leak-abort path without
  a network or key.
- The release-gate red-team must re-run: the output _path_ changed even though
  the controls did not (ADR-0009-style live re-verification).
- More moving parts than the buffered path; the buffered path stays maintained
  as the reference implementation and fallback.

## Revisit conditions

- The API stops interleaving citations with text (or delays them to the end):
  the grounding buffer would stall into a near-buffered experience — fall back
  to the buffered path for affected models.
- A leak class emerges that fingerprint-plus-tail-hold-back cannot catch (e.g. a
  semantic policy leak with no fixed phrase). Fingerprinting is already a
  defense-in-depth tripwire, not the primary control (retrieval scoping and the
  system policy are) — but if streamed leaks become a real risk, reconsider
  emitting only at sentence boundaries after a fuller check.
- Measured latency/engagement gains do not justify the added complexity — revert
  JS clients to the maintained buffered path.
