import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contentLastmods, noteLastmods } from "../../src/lib/content-dates";

// Isolated fixture tree (<root>/src/content/notes) so the logic is tested
// without coupling to the real corpus.
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "content-dates-"));
  const dir = join(root, "src/content/notes");
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, "updated.md"),
    "---\ntitle: Updated\ndescription: d\npubDate: 2026-07-10\nupdatedDate: 2026-07-15\n---\nbody\n",
  );
  await writeFile(
    join(dir, "published.md"),
    "---\ntitle: Published\ndescription: d\npubDate: 2026-07-11\n---\nbody\n",
  );
  await writeFile(
    join(dir, "draft.md"),
    "---\ntitle: Draft\ndescription: d\npubDate: 2026-07-12\ndraft: true\n---\nbody\n",
  );

  const profileDir = join(root, "src/content/profile");
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    join(profileDir, "now.md"),
    "---\ntitle: Now\norder: 8\nupdatedDate: 2026-07-20\ncorpus: false\ntags:\n  - now\n---\nbody\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("noteLastmods", () => {
  it("keys by served note path and prefers updatedDate over pubDate", async () => {
    const map = await noteLastmods(root);
    expect(map.get("/notes/updated")).toBe("2026-07-15T00:00:00.000Z");
    expect(map.get("/notes/published")).toBe("2026-07-11T00:00:00.000Z");
  });

  it("skips draft notes", async () => {
    const map = await noteLastmods(root);
    expect(map.has("/notes/draft")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("emits valid ISO 8601 date strings", async () => {
    for (const value of (await noteLastmods(root)).values()) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Number.isNaN(Date.parse(value))).toBe(false);
    }
  });
});

describe("contentLastmods", () => {
  it("adds /now from the profile entry's updatedDate alongside the notes", async () => {
    const map = await contentLastmods(root);
    expect(map.get("/now")).toBe("2026-07-20T00:00:00.000Z");
    expect(map.get("/notes/updated")).toBe("2026-07-15T00:00:00.000Z");
    expect(map.size).toBe(3);
  });
});
