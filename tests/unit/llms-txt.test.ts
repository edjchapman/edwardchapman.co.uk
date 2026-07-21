import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { buildLlmsText } from "../../scripts/build-llms-txt.ts";
import { SITE } from "../../src/lib/site.ts";

const root = process.cwd();

/** Re-derive expectations from the content files, independent of the builder. */
async function collectionTitles(
  dir: string,
): Promise<{ published: string[]; drafts: string[] }> {
  const base = join(root, "src/content", dir);
  const published: string[] = [];
  const drafts: string[] = [];
  for (const file of (await readdir(base)).filter((f) => f.endsWith(".md"))) {
    const raw = await readFile(join(base, file), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const data = (parseYaml(match?.[1] ?? "") ?? {}) as {
      title?: string;
      draft?: boolean;
    };
    if (typeof data.title !== "string") continue;
    (data.draft ? drafts : published).push(data.title);
  }
  return { published, drafts };
}

describe("llms.txt generation", () => {
  it("lists every published entry by its exact frontmatter title, and no draft", async () => {
    const text = await buildLlmsText(root);
    for (const dir of ["projects", "notes"]) {
      const { published, drafts } = await collectionTitles(dir);
      expect(published.length).toBeGreaterThan(0);
      for (const title of published) expect(text).toContain(`[${title}]`);
      for (const title of drafts) expect(text).not.toContain(title);
    }
  });

  it("links every fixed page on the canonical origin", async () => {
    const text = await buildLlmsText(root);
    for (const path of [
      "/",
      "/projects",
      "/notes",
      "/experience",
      "/ask",
      "/colophon",
      "/privacy",
    ]) {
      expect(text).toContain(`(${SITE.origin}${path})`);
    }
  });

  it("contains only the approved contact email", async () => {
    const text = await buildLlmsText(root);
    const emails = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toBe(SITE.email);
  });

  it("links only the canonical origin and published external sources", async () => {
    const text = await buildLlmsText(root);
    const allowedPrefixes: string[] = [SITE.origin, SITE.github, SITE.linkedin];
    for (const dir of ["projects"]) {
      const base = join(root, "src/content", dir);
      for (const file of (await readdir(base)).filter((f) =>
        f.endsWith(".md"),
      )) {
        const raw = await readFile(join(base, file), "utf8");
        const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
        const data = (parseYaml(match?.[1] ?? "") ?? {}) as {
          repo?: string;
          demo?: string;
        };
        if (data.repo) allowedPrefixes.push(data.repo);
        if (data.demo) allowedPrefixes.push(data.demo);
      }
    }
    const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
    for (const url of urls) {
      expect(
        allowedPrefixes.some((prefix) => url.startsWith(prefix)),
        `unexpected URL in llms.txt: ${url}`,
      ).toBe(true);
    }
  });
});
