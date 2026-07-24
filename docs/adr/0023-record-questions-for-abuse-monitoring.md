# ADR-0023: Record submitted questions in operational logs for abuse monitoring

**Status:** Accepted (2026-07-25)

## Context

Since release, the ask endpoint's structured Worker events were deliberately
content-free — "logs exclude their text" was a published privacy commitment,
pinned by e2e and recorded as a release-gate condition in
docs/evaluation.md. The trade-off that bought was blindness: the site owner
had no visibility of what visitors actually submit, including adversarial
use. The automated red-team probes cover _known_ attack classes twice
daily, but novel abuse attempts by real visitors were invisible.

Ed directed the change on 2026-07-25: record the submitted questions —
the assistant answers from public information only, and he wants to know
if people are using it to attack him.

## Decision

Record the visitor's question **once per accepted request**, as a
`question` field on the existing `ask.accepted` structured event
(`src/lib/agent/service.ts`), flowing into Workers Logs via the
already-enabled observability pipeline.

- **No new infrastructure.** The spec's "simplicity before infrastructure"
  principle holds: no database, no KV/D1/Durable Objects. Workers Logs'
  platform retention (days, not months) bounds the exposure automatically —
  the recording is an expiring operational window, not an archive.
- **Questions only, bounded.** The field is capped at the same 500
  characters the API validates; answers are never logged (they are derived
  from published content anyway; the question is the abuse signal).
- **Disclosed.** /privacy now states that questions are recorded in the
  site's operational logs for abuse detection and expire automatically;
  the "don't include personal or sensitive information" warning stays on
  both surfaces. The e2e privacy pins assert the new sentences.
- **Purpose-bound.** The recording exists for abuse/security monitoring —
  a legitimate-interest purpose with short retention and clear disclosure.
  Reviewing what refuses (and why) to improve the corpus is a natural
  secondary use of the same window.

## Alternatives considered

- **Stay content-free** (status quo): preserved the strongest privacy
  story, but the owner explicitly values abuse visibility above it, and
  the content-free refusal-reason telemetry cannot reveal novel attacks.
- **Workers Analytics Engine**: ~90-day queryable window; the right
  upgrade if log-retention windows prove too short for pattern analysis —
  deferred until that need is demonstrated, per the spec's
  infrastructure-on-evidence rule.
- **A database**: an archive with indefinite retention creates data-
  controller obligations out of proportion to the monitoring need.
  Rejected.

## Consequences

- The privacy page's promise changed with the behaviour, in the same
  change — the page, the pins, and the code cannot drift apart.
- docs/evaluation.md's release-gate paragraph is annotated: its
  "logs verified redacted" condition described the launch posture, which
  this ADR deliberately supersedes.
- Abuse review is `wrangler tail edwardchapman` or the dashboard's live
  logs, filtering `ask.accepted`; each event pairs the question with a
  requestId traceable through the rest of that request's events.
- Revisit trigger: if question review becomes routine rather than
  incident-driven, or the window proves too short, adopt Analytics Engine
  via a superseding ADR.
