/**
 * The exact refusal sentence, alone in its own module so the AskForm island
 * can import it without pulling prompt.ts — and therefore SYSTEM_POLICY —
 * into the shipped client bundle. The value is frozen: service.ts matches it
 * to detect model declines, and the eval fixtures pin it.
 */
export const REFUSAL_TEXT =
  "I could not find enough published information on this site to answer that reliably.";
