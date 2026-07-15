/**
 * Built-output link gate: parses dist/**\/*.html (plus the sitemap when
 * present) and validates every internal reference:
 *
 *   1. The target exists in dist/ (no broken internal links ship).
 *   2. Internal paths carry no trailing slash (canonical policy — see
 *      ADR-0001..; wrangler's html_handling redirects `/x/` to `/x`).
 *   3. Absolute internal links use only the canonical origin.
 *
 * Runs under plain Node (erasable-syntax TypeScript only). Exits 1 on failure.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_ORIGIN = "https://edwardchapman.co.uk";

// Worker-rendered routes have no dist/ file; they are valid link targets.
const WORKER_ROUTE_PREFIXES = ["/api/"];

export type LinkProblem = {
  file: string;
  url: string;
  reason: string;
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/**
 * True only for the canonical origin itself or a path under it — never a
 * look-alike host (edwardchapman.co.uk.evil.example) that a bare prefix check
 * would wrongly accept as on-origin.
 */
function isCanonicalOrigin(url: string): boolean {
  return url === CANONICAL_ORIGIN || url.startsWith(`${CANONICAL_ORIGIN}/`);
}

function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !isCanonicalOrigin(url);
}

/** Resolve an internal path to its dist/ file, honouring build.format "file". */
function resolvesInDist(distDir: string, path: string): boolean {
  if (WORKER_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  const clean = path.replace(/[?#].*$/, "");
  if (clean === "/") return existsSync(join(distDir, "index.html"));
  const candidates = [
    join(distDir, `${clean}.html`),
    join(distDir, clean, "index.html"),
    join(distDir, clean),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

export function checkUrl(
  file: string,
  rawUrl: string,
  distDir: string,
): LinkProblem | null {
  if (rawUrl === "" || rawUrl.startsWith("#") || rawUrl.startsWith("data:")) {
    return null;
  }
  if (isExternal(rawUrl)) return null; // external links: separate checker

  let path = rawUrl;
  if (isCanonicalOrigin(rawUrl)) {
    path = rawUrl.slice(CANONICAL_ORIGIN.length) || "/";
  }
  if (!path.startsWith("/")) {
    return { file, url: rawUrl, reason: "relative link — use root-relative" };
  }

  const withoutSuffix = path.replace(/[?#].*$/, "");
  if (withoutSuffix !== "/" && withoutSuffix.endsWith("/")) {
    return { file, url: rawUrl, reason: "trailing slash (canonical policy)" };
  }
  if (!resolvesInDist(distDir, withoutSuffix)) {
    return { file, url: rawUrl, reason: "target missing from dist/" };
  }
  return null;
}

function checkHtmlFile(distDir: string, file: string): LinkProblem[] {
  const html = readFileSync(file, "utf8");
  const problems: LinkProblem[] = [];
  const relFile = file.slice(distDir.length + 1);

  for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const problem = checkUrl(relFile, match[1] ?? "", distDir);
    if (problem) problems.push(problem);
  }
  return problems;
}

function checkSitemaps(distDir: string): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const sitemaps = readdirSync(distDir).filter(
    (entry) => entry.startsWith("sitemap") && entry.endsWith(".xml"),
  );

  for (const sitemap of sitemaps) {
    const xml = readFileSync(join(distDir, sitemap), "utf8");
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = match[1] ?? "";
      if (loc.endsWith(".xml")) continue; // sitemap-index entries
      if (!isCanonicalOrigin(loc)) {
        problems.push({
          file: sitemap,
          url: loc,
          reason: "non-canonical origin",
        });
        continue;
      }
      const problem = checkUrl(sitemap, loc, distDir);
      if (problem) problems.push(problem);
    }
  }
  return problems;
}

function main(): void {
  // The adapter emits static assets to dist/client (worker bundle: dist/server).
  const distDir = join(process.cwd(), "dist", "client");
  if (!existsSync(distDir)) {
    console.error(
      "check-internal-links: dist/client missing — run the build first",
    );
    process.exit(1);
  }

  const problems: LinkProblem[] = [];
  for (const file of walk(distDir)) {
    if (file.endsWith(".html")) problems.push(...checkHtmlFile(distDir, file));
  }
  problems.push(...checkSitemaps(distDir));

  if (problems.length > 0) {
    console.error("internal-links: problems found\n");
    for (const p of problems) {
      console.error(`  ${p.file}: ${p.url} — ${p.reason}`);
    }
    process.exit(1);
  }
  console.log("internal-links: OK — all internal references valid");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
