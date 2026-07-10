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
  updatedDate: z.coerce.date().optional(),
  /** Whether the Phase-3 agent corpus may ingest this entry. */
  corpus: z.boolean().default(true),
});

export type Project = z.infer<typeof projectSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Profile = z.infer<typeof profileSchema>;
