import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The spec (docs/spec.md §6) makes the "limitations" and "next" sections of
// every case study mandatory — they demonstrate judgement more effectively
// than pretending every project is finished. This test enforces it for every
// published (non-draft) project entry.
const PROJECTS_DIR = join(process.cwd(), "src/content/projects");

const REQUIRED_HEADINGS = [
  "## Context",
  "## Problem",
  "## Constraints",
  "## Architecture",
  "## Important engineering decisions",
  "## Alternatives considered",
  "## Testing and quality approach",
  "## Operational or deployment model",
  "## Outcome",
  "## Current limitations",
  "## What I'd do next",
  "## Relevant links",
];

const publishedEntries = readdirSync(PROJECTS_DIR)
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({
    name,
    text: readFileSync(join(PROJECTS_DIR, name), "utf8"),
  }))
  .filter(({ text }) => !/^draft:\s*true$/m.test(text));

describe("case-study structure", () => {
  it("has published entries to check", () => {
    expect(publishedEntries.length).toBeGreaterThan(0);
  });

  for (const { name, text } of publishedEntries) {
    describe(name, () => {
      for (const heading of REQUIRED_HEADINGS) {
        it(`contains "${heading}"`, () => {
          expect(text).toContain(`\n${heading}\n`);
        });
      }
    });
  }
});
