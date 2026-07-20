/**
 * Content-derived sitemap `lastmod` dates. Read at astro.config load time —
 * where `astro:content` isn't available — so frontmatter is parsed off disk,
 * the same approach scripts/build-og-cards.ts uses. Kept out of the config
 * file itself so it stays unit-testable.
 *
 * Only notes get a `lastmod`: they carry real content dates
 * (`updatedDate ?? pubDate`). Projects have no date field, and stamping the
 * homepage / static pages with the build time would mark every URL "changed
 * today" on each deploy — a signal crawlers discount. Omitting `lastmod` for
 * undated URLs is deliberate, not a gap; do not "fix" it with build-time
 * stamps.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { noteSchema } from "./schemas";

function frontmatter(raw: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  return (parseYaml(match?.[1] ?? "") ?? {}) as Record<string, unknown>;
}

/**
 * Map of served note path (`/notes/<id>`, slash-free) to an ISO 8601 date
 * string, `updatedDate` when present else `pubDate`. Draft notes are skipped,
 * consistent with every published-content query in the codebase.
 */
export async function noteLastmods(
  root: string = process.cwd(),
): Promise<Map<string, string>> {
  const dir = join(root, "src/content/notes");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const lastmods = new Map<string, string>();

  for (const file of files) {
    const data = noteSchema.parse(
      frontmatter(await readFile(join(dir, file), "utf8")),
    );
    if (data.draft) continue;
    const id = file.replace(/\.md$/, "");
    const date = data.updatedDate ?? data.pubDate;
    lastmods.set(`/notes/${id}`, date.toISOString());
  }

  return lastmods;
}
