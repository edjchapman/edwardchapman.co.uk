/**
 * Agent API contracts (spec §10, ADR-0012): request/response validation for
 * /api/ask and the normalised answer shape adapters must produce. Pure zod —
 * shared by the Worker route, the service layer, and the test suites.
 */

import { z } from "zod";

export const MAX_QUESTION_LENGTH = 500;
export const MAX_BODY_BYTES = 4096;

export const askRequestSchema = z.object({
  question: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(MAX_QUESTION_LENGTH)),
});

export const sourceSchema = z.object({
  title: z.string(),
  url: z.url(),
});

/** Half-open character span into `answer`, pointing at a `sources` entry. */
export const citationSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  sourceIndex: z.number().int().min(0),
});

export const askResponseSchema = z
  .object({
    answer: z.string(),
    citations: z.array(citationSpanSchema),
    sources: z.array(sourceSchema),
    requestId: z.string(),
  })
  .superRefine((value, ctx) => {
    let previousStart = -1;
    for (const [index, citation] of value.citations.entries()) {
      if (
        citation.start >= citation.end ||
        citation.end > value.answer.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index],
          message: "span must satisfy 0 <= start < end <= answer.length",
        });
      }
      if (citation.sourceIndex >= value.sources.length) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index, "sourceIndex"],
          message: "sourceIndex must reference an entry in sources",
        });
      }
      if (citation.start < previousStart) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index, "start"],
          message: "citations must be sorted ascending by start",
        });
      }
      previousStart = citation.start;
    }
  });

export const askErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "method_not_allowed",
      "rate_limited",
      "quota_exceeded",
      "not_found",
      "upstream_error",
      "upstream_unavailable",
    ]),
    message: z.string(),
  }),
  requestId: z.string(),
});

/**
 * Normalised adapter output (ADR-0012), before service whitelisting.
 * Out-of-range `documentIndex` values are deliberately not schema-invalid:
 * bounds need the supplied-passage count, which is the service's job.
 */
export const modelCitationSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  documentIndex: z.number().int().min(0),
});

export const modelAnswerSchema = z
  .object({
    text: z.string().min(1),
    citations: z.array(modelCitationSchema),
  })
  .superRefine((value, ctx) => {
    for (const [index, citation] of value.citations.entries()) {
      if (citation.start >= citation.end || citation.end > value.text.length) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index],
          message: "span must satisfy 0 <= start < end <= text.length",
        });
      }
    }
  });

export type AskRequest = z.infer<typeof askRequestSchema>;
export type AskResponse = z.infer<typeof askResponseSchema>;
export type AskError = z.infer<typeof askErrorSchema>;
