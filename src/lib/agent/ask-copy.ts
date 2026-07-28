/**
 * Visitor-facing copy for every /api/ask error code, in its own import-free
 * module (like refusal.ts) so the AskForm island can import the strings it
 * mirrors without pulling server code into the client bundle. The route
 * assembles its ERROR_MESSAGE table from these; the client imports the three
 * it renders for terminal stream events. Single source of truth — the copy
 * was previously hand-duplicated across ask.ts and AskForm.tsx and drifted.
 *
 * Two failure classes are deliberately distinct (ADR-0026):
 * - `upstream_error` (502) — transient (provider 500/529, a timeout): a retry
 *   may succeed, so the copy invites one.
 * - `upstream_unavailable` (503) — non-retryable (billing 400, dead key 401,
 *   retired model 404): retrying won't help until the operator acts, so the
 *   copy is honest that the service is offline and points at the published
 *   pages instead of inviting a doomed retry.
 */

export const INVALID_REQUEST_MESSAGE =
  'Send JSON like {"question": "…"} — up to 500 characters.';

export const METHOD_NOT_ALLOWED_MESSAGE = "Use POST with a JSON body.";

export const RATE_LIMITED_MESSAGE =
  "Too many questions right now — please try again in a minute.";

export const QUOTA_EXCEEDED_MESSAGE =
  "You've reached today's question limit for this demo — please come back " +
  "tomorrow. Everything the assistant knows is on the published pages.";

export const NOT_FOUND_MESSAGE = "Not found.";

export const UPSTREAM_ERROR_MESSAGE =
  "The answer service had a problem. Nothing you did — try again shortly.";

export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "The answer service is temporarily offline — a fault on Ed's side, flagged " +
  "for attention. Everything the assistant knows is on the published pages.";
