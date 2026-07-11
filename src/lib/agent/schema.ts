/**
 * Agent API contracts (spec §10): request/response validation for /api/ask
 * and the structured shape the model must return. Pure zod — shared by the
 * Worker route, the service layer, and the test suites.
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

export const askResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(sourceSchema),
  requestId: z.string(),
});

export const askErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "method_not_allowed",
      "rate_limited",
      "not_found",
      "upstream_error",
    ]),
    message: z.string(),
  }),
  requestId: z.string(),
});

/** What the model must return (structured output), before whitelisting. */
export const modelAnswerSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(z.string()).default([]),
});

/** JSON Schema handed to the provider's structured-output constraint. */
export const MODEL_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "The grounded answer, or the exact refusal sentence.",
    },
    citations: {
      type: "array",
      items: { type: "string" },
      description: "sectionIds of the supplied passages actually used.",
    },
  },
  required: ["answer", "citations"],
  additionalProperties: false,
} as const;

export type AskRequest = z.infer<typeof askRequestSchema>;
export type AskResponse = z.infer<typeof askResponseSchema>;
export type AskError = z.infer<typeof askErrorSchema>;
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
