/**
 * External-link checker: collects every external URL from content sources
 * and public text files, then verifies each responds (HEAD, falling back to
 * GET) with a non-error status. Deliberately NOT part of `make check` — the
 * network is flaky and third-party outages shouldn't block merges. Runs
 * manually (`make check-external-links`) and in the weekly scheduled
 * workflow.
 *
 * Runs under plain Node (erasable-syntax TypeScript only).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_ROOTS = ["src/content", "src/lib", "src/pages", "public"];
const SCAN_EXTENSIONS = new Set([".md", ".mdx", ".astro", ".ts", ".txt"]);
const INTERNAL_ORIGIN = "https://edwardchapman.co.uk";
const TIMEOUT_MS = 15_000;
const RETRIES = 2;

// Hosts that answer automated clients with error-ish statuses (LinkedIn's
// infamous 999). Any HTTP response from these counts as reachable; only a
// network-level failure fails the check.
const BOT_HOSTILE_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

function isBotHostile(url: string): boolean {
  try {
    return BOT_HOSTILE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

type LinkFailure = { url: string; files: string[]; reason: string };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function extractExternalUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (!url.startsWith(INTERNAL_ORIGIN)) urls.add(url);
  }
  return [...urls];
}

async function probe(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    for (const method of ["HEAD", "GET"]) {
      try {
        const response = await fetch(url, {
          method,
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "user-agent": "edwardchapman.co.uk link checker" },
        });
        if (response.ok || response.status === 429) return null;
        if (isBotHostile(url)) return null; // responded at all → reachable
        if (method === "GET" && response.status >= 400) {
          if (attempt < RETRIES) break; // retry the pair
          return `HTTP ${response.status}`;
        }
      } catch (error) {
        if (method === "GET" && attempt === RETRIES) {
          return error instanceof Error ? error.message : "network error";
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  return "unreachable";
}

async function main(): Promise<void> {
  const root = process.cwd();
  const found = new Map<string, Set<string>>();

  for (const scanRoot of SCAN_ROOTS) {
    let rootStat;
    try {
      rootStat = statSync(join(root, scanRoot));
    } catch {
      continue;
    }
    if (!rootStat.isDirectory()) continue;

    for (const file of walk(join(root, scanRoot))) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      const rel = file.slice(root.length + 1);
      for (const url of extractExternalUrls(readFileSync(file, "utf8"))) {
        if (!found.has(url)) found.set(url, new Set());
        found.get(url)?.add(rel);
      }
    }
  }

  console.log(`external-links: probing ${found.size} unique URLs…`);
  const failures: LinkFailure[] = [];
  for (const [url, files] of found) {
    const reason = await probe(url);
    if (reason) failures.push({ url, files: [...files], reason });
  }

  if (failures.length > 0) {
    console.error("\nexternal-links: failures\n");
    for (const failure of failures) {
      console.error(`  ${failure.url} — ${failure.reason}`);
      for (const file of failure.files)
        console.error(`    referenced in ${file}`);
    }
    process.exit(1);
  }
  console.log("external-links: OK — all external references respond");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
