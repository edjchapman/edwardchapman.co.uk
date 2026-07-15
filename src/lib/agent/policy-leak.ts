/**
 * Policy-leak fingerprints (spec §10 "avoid revealing the system prompt"): a
 * defense-in-depth tripwire shared by the buffered path (whole-answer check)
 * and the streaming guard (incremental check with tail hold-back, ADR-0016).
 * Not the primary control — retrieval scoping and the system policy are — so
 * this stays a small, exact substring set rather than a classifier.
 */

const POLICY_FINGERPRINTS = [
  'the "ask" assistant on edwardchapman.co.uk',
  "Rules, in priority order",
  "system policy",
];

/**
 * Longest fingerprint. The streaming guard withholds this many trailing
 * characters so a fingerprint straddling a delta boundary is detected before
 * its final character is ever emitted (ADR-0016).
 */
export const MAX_FINGERPRINT_LENGTH = Math.max(
  ...POLICY_FINGERPRINTS.map((fingerprint) => fingerprint.length),
);

export function looksLikePolicyLeak(answer: string): boolean {
  const lower = answer.toLowerCase();
  return POLICY_FINGERPRINTS.some((fingerprint) =>
    lower.includes(fingerprint.toLowerCase()),
  );
}
