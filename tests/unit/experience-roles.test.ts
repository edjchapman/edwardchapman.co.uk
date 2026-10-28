import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { profileSchema } from "../../src/lib/schemas";

// The homepage experience list renders the `roles` frontmatter (ADR-0030).
// Content boundary: structured rows may only restate the entry's published
// prose, so every org, sector, title and year must appear in the body.
const raw = readFileSync("src/content/profile/experience.md", "utf8");
const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
const data = profileSchema.parse(parseYaml(match?.[1] ?? ""));
const body = (match?.[2] ?? "").toLowerCase();

describe("experience roles restate the published prose", () => {
  it("defines rows", () => {
    expect(data.roles?.length).toBeGreaterThan(0);
  });

  for (const role of data.roles ?? []) {
    it(`${role.org}: org, sector and years appear in the body`, () => {
      expect(body).toContain(role.org.toLowerCase());
      expect(body).toContain(role.sector.toLowerCase());
      for (const year of role.years.match(/\d{4}/g) ?? []) {
        expect(body).toContain(year);
      }
    });

    it(`${role.org}: the title appears in the body`, () => {
      const [lead = ""] = role.title.split(",");
      expect(body).toContain(lead.trim().toLowerCase());
    });
  }
});
