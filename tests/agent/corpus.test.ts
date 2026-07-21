import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCorpus } from "../../scripts/build-agent-corpus";

const FIXTURE_ROOT = join(process.cwd(), "tests/agent/fixtures/content-root");

describe("corpus construction (fixture root)", () => {
  const corpus = buildCorpus(FIXTURE_ROOT);
  const ids = corpus.chunks.map((chunk) => chunk.sectionId);
  const allText = corpus.chunks.map((chunk) => chunk.text).join("\n");

  it("excludes draft projects and notes entirely", () => {
    expect(ids.some((id) => id.startsWith("draft-project#"))).toBe(false);
    expect(ids.some((id) => id.startsWith("draft-note#"))).toBe(false);
    expect(allText).not.toContain("Secret");
    expect(allText).not.toContain("Draft note text");
  });

  it("excludes profile entries with corpus: false", () => {
    expect(ids.some((id) => id.startsWith("excluded#"))).toBe(false);
    expect(allText).not.toContain("Opted out");
  });

  it("produces stable section IDs: card, intro, and heading slugs", () => {
    expect(ids).toContain("published#card");
    expect(ids).toContain("published#intro");
    expect(ids).toContain("published#architecture");
    expect(ids).toContain("published#current-limitations");
    expect(ids).toContain("included#body");
  });

  it("splits sectioned profile entries; heading-less prose keeps #body", () => {
    expect(ids).toContain("sectioned#intro");
    expect(ids).toContain("sectioned#first-topic");
    expect(ids).toContain("sectioned#second-topic");
    expect(ids).not.toContain("sectioned#body");
    const first = corpus.chunks.find(
      (chunk) => chunk.sectionId === "sectioned#first-topic",
    );
    expect(first?.title).toBe("Sectioned — First topic");
  });

  it("attaches canonical URLs and metadata to every chunk", () => {
    for (const chunk of corpus.chunks) {
      expect(chunk.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
      expect(chunk.title.length).toBeGreaterThan(0);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic: same input, same version hash", () => {
    const again = buildCorpus(FIXTURE_ROOT);
    expect(again.version).toBe(corpus.version);
    expect(again.chunks).toEqual(corpus.chunks);
  });
});

describe("corpus construction (real content)", () => {
  const corpus = buildCorpus(process.cwd());

  it("contains the published collections and nothing else", () => {
    const types = new Set(corpus.chunks.map((chunk) => chunk.type));
    expect([...types].sort()).toEqual(["note", "profile", "project"]);
    expect(corpus.chunks.length).toBeGreaterThan(20);
  });

  it("never contains prohibited private-source terms", () => {
    const allText = corpus.chunks
      .map((chunk) => `${chunk.title}\n${chunk.text}`)
      .join("\n")
      .toLowerCase();
    expect(allText).not.toContain("career-portfolio");
    expect(allText).not.toContain("edchapman88@gmail.com");
  });
});
