# ADR-0029: AI Gateway request logs retain questions and answers

**Status:** Accepted (2026-10-08). Supersedes in part
[ADR-0023](0023-record-questions-for-abuse-monitoring.md) (its "answers are
never logged" and expiring-window-only retention) and spec §13's "No model
response logging by default".

## Context

Activating the ADR-0025 spend guard (issue #162) created the
`edwardchapman-ask` AI Gateway. Its **Collect Logs** setting, on by default,
stores each request's full payload — the question, the retrieved documents,
and the generated answer — with token counts, cost, and latency. Retention is
by count, not age: the most recent 100,000 requests, oldest deleted first.

That contradicts two recorded commitments. ADR-0023 records questions only in
Workers Logs, whose platform retention expires in days, and states answers
are never logged; it rejected an archive for its data-controller obligations.
At this site's traffic, a 100,000-entry ring buffer is effectively an archive.

## Decision

Keep gateway log collection **on**, and disclose it.

- **What is kept:** for every question that reaches the model, the gateway
  request (question and retrieved published content) and the response
  (answer text), plus usage metadata. Baseline hits (ADR-0027) and requests
  refused before the model never reach the gateway and are not kept there.
- **Retention:** the most recent 100,000 requests; the oldest is deleted
  first. No time-based expiry. Log Classification and Logpush export stay
  off, so the logs are not analysed or copied elsewhere.
- **Purpose:** per-request debugging and cost diagnosis — seeing exactly what
  a costly or wrong answer was given and returned — beside ADR-0023's abuse
  monitoring. The aggregate Analytics view covers volume and cost; only the
  log shows the payload.
- **Disclosed:** /privacy states that model questions are kept with their
  answers in the gateway's request log, and the retention rule. The e2e
  privacy pins assert both.

ADR-0023's Workers Logs recording is unchanged: questions there still expire
with platform retention.

## Alternatives considered

- **Collect Logs off.** Keeps ADR-0023 intact; Analytics still give request,
  token, and cost totals. Rejected by the owner: without payloads, an
  unexpected answer or cost spike cannot be traced to its request.
- **A small log limit (e.g. 1,000).** Shortens retention but still stores
  answers, so it needs this same supersession; the practical window would
  vary with traffic rather than being a stated period.

## Consequences

- /privacy's "answers are never stored" promise is withdrawn and replaced by
  a disclosure of what is kept and for how long, in the same change.
- The site now holds answer text outside Workers Logs. A deletion request for
  a specific question means finding it in the gateway's log viewer by time.
- Disabling Collect Logs later restores ADR-0023's posture without code
  change; /privacy and its pins would revert with it.

## Revisit conditions

- Cloudflare adds time-based log expiry → set a stated period and update
  /privacy to name it.
- A deletion or access request proves hard to serve from the log viewer →
  reconsider a lower limit or turning collection off.
