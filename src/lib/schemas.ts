/**
 * Shared content schemas — pure zod, no `astro:*` imports, so the same
 * definitions serve Astro's content collections (src/content.config.ts),
 * standalone Node scripts (scripts/*.ts), and the Phase-3 corpus builder.
 */

import { z } from "zod";

export const projectSchema = z.object({
  title: z.string().min(1),
  /** One-sentence problem statement (project card). */
  problem: z.string().min(1),
  /** What was built (project card). */
  built: z.string().min(1),
  /** The technically differentiating feature (project card). */
  differentiator: z.string().min(1),
  tech: z.array(z.string().min(1)).min(1),
  /** Headline measurements for the card's metric strip. Content boundary:
   * every value must already be published in this project's own prose —
   * the strip surfaces evidence, it never introduces it. */
  metrics: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .max(3)
    .default([]),
  repo: z.url(),
  demo: z.url().optional(),
  featured: z.boolean().default(false),
  order: z.number().int().min(0),
  draft: z.boolean().default(false),
  ogImage: z.string().optional(),
});

export const noteSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  tags: z.array(z.string().min(1)).default([]),
  draft: z.boolean().default(false),
  canonicalURL: z.url().optional(),
  /** Optional relationship to a projects-collection entry id. */
  relatedProject: z.string().optional(),
  ogImage: z.string().optional(),
});

export const profileSchema = z.object({
  title: z.string().min(1),
  /** Render order within homepage sections. */
  order: z.number().int().min(0),
  /** Short positioning line (hero use; positioning entry only). */
  tagline: z.string().optional(),
  updatedDate: z.coerce.date().optional(),
  /** Whether the Phase-3 agent corpus may ingest this entry. */
  corpus: z.boolean().default(true),
  /**
   * Lexical retrieval hints for the agent corpus. Profile prose is short and
   * dense, so its own words often miss a visitor's phrasing; these accurate
   * tags carry the vocabulary people actually search (retrieval boosts them
   * like the title). They must describe the entry truthfully, never inflate.
   */
  tags: z.array(z.string()).default([]),
});

export type Project = z.infer<typeof projectSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Profile = z.infer<typeof profileSchema>;
