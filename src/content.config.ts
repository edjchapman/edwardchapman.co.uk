import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

import { noteSchema, profileSchema, projectSchema } from "./lib/schemas";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: projectSchema,
});

const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
  schema: noteSchema,
});

const profile = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/profile" }),
  schema: profileSchema,
});

export const collections = { projects, notes, profile };
