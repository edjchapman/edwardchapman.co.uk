import { describe, expect, it } from "vitest";

import {
  noteSchema,
  profileSchema,
  projectSchema,
} from "../../src/lib/schemas";

const validProject = {
  title: "Foreman",
  problem: "Jobs get lost at crash boundaries.",
  built: "A transactional-outbox pipeline.",
  differentiator: "Measured reliability.",
  tech: ["Python", "Django"],
  repo: "https://github.com/edjchapman/Foreman",
  demo: "https://foreman-demo.up.railway.app",
  featured: true,
  order: 1,
};

describe("projectSchema", () => {
  it("accepts a complete entry and applies defaults", () => {
    const parsed = projectSchema.parse(validProject);
    expect(parsed.draft).toBe(false);
    expect(parsed.demo).toBe("https://foreman-demo.up.railway.app");
  });

  it("rejects a non-URL repo", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      repo: "github.com/edjchapman/Foreman",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing card copy", () => {
    const rest: Record<string, unknown> = { ...validProject };
    delete rest["problem"];
    expect(projectSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty tech list", () => {
    const result = projectSchema.safeParse({ ...validProject, tech: [] });
    expect(result.success).toBe(false);
  });

  it("rejects negative ordering", () => {
    const result = projectSchema.safeParse({ ...validProject, order: -1 });
    expect(result.success).toBe(false);
  });

  it("defaults metrics to empty and accepts value/label pairs", () => {
    expect(projectSchema.parse(validProject).metrics).toEqual([]);
    const parsed = projectSchema.parse({
      ...validProject,
      metrics: [{ value: "1.84s → 0.34s", label: "p95 queue wait" }],
    });
    expect(parsed.metrics).toHaveLength(1);
  });

  it("rejects empty metric strings and more than three metrics", () => {
    expect(
      projectSchema.safeParse({
        ...validProject,
        metrics: [{ value: "", label: "p95" }],
      }).success,
    ).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => ({
      value: `${i}`,
      label: `metric ${i}`,
    }));
    expect(
      projectSchema.safeParse({ ...validProject, metrics: four }).success,
    ).toBe(false);
  });
});

describe("noteSchema", () => {
  const validNote = {
    title: "LLM-as-judge as a CI quality gate",
    description: "Scoring model output in CI.",
    pubDate: "2026-07-10",
  };

  it("coerces dates and applies defaults", () => {
    const parsed = noteSchema.parse(validNote);
    expect(parsed.pubDate).toBeInstanceOf(Date);
    expect(parsed.draft).toBe(false);
    expect(parsed.tags).toEqual([]);
  });

  it("rejects an invalid pubDate", () => {
    const result = noteSchema.safeParse({
      ...validNote,
      pubDate: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL canonicalURL", () => {
    const result = noteSchema.safeParse({
      ...validNote,
      canonicalURL: "notes/foo",
    });
    expect(result.success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("defaults corpus to true (and lets entries opt out)", () => {
    const parsed = profileSchema.parse({ title: "Positioning", order: 1 });
    expect(parsed.corpus).toBe(true);

    const optedOut = profileSchema.parse({
      title: "Colophon",
      order: 4,
      corpus: false,
    });
    expect(optedOut.corpus).toBe(false);
  });

  it("rejects a missing order", () => {
    expect(profileSchema.safeParse({ title: "X" }).success).toBe(false);
  });
});
