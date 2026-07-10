/**
 * Content-policy gate: scans source trees and built output for prohibited
 * material (see docs/content-policy.md). Rules live in
 * scripts/content-policy-rules.json so policy changes are reviewable diffs.
 *
 * Runs under plain Node (erasable-syntax TypeScript only). Exits 1 with
 * file:line:rule output on any violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Rule = {
  id: string;
  description: string;
  pattern: string;
  flags?: string;
  paths: string[];
  enabled?: boolean;
};

export type PolicyConfig = {
  allowedEmails: string[];
  rules: Rule[];
};

export type Violation = {
  file: string;
  line: number;
  ruleId: string;
  excerpt: string;
};

const SCANNED_EXTENSIONS = new Set([
  ".astro",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const ALLOW_MARKER = "content-policy-allow:";

function ruleAppliesTo(rule: Rule, relPath: string): boolean {
  return rule.paths.some(
    (prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`),
  );
}

/** Scan one file's text against every applicable rule. Pure — unit-testable. */
export function scanText(
  relPath: string,
  text: string,
  config: PolicyConfig,
): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split("\n");
  const activeRules = config.rules.filter(
    (rule) => rule.enabled !== false && ruleAppliesTo(rule, relPath),
  );

  for (const rule of activeRules) {
    const flags = rule.flags?.includes("g")
      ? rule.flags
      : `${rule.flags ?? ""}g`;
    const regex = new RegExp(rule.pattern, flags);

    lines.forEach((line, index) => {
      if (line.includes(`${ALLOW_MARKER}${rule.id}`)) return;
      for (const match of line.matchAll(regex)) {
        const matched = match[0];
        if (
          rule.id === "email-address" &&
          config.allowedEmails.includes(matched.toLowerCase())
        ) {
          continue;
        }
        violations.push({
          file: relPath,
          line: index + 1,
          ruleId: rule.id,
          excerpt: matched,
        });
      }
    });
  }

  return violations;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile()) {
      yield full;
    }
  }
}

export function scanRepo(root: string, config: PolicyConfig): Violation[] {
  const roots = [...new Set(config.rules.flatMap((rule) => rule.paths))];
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const scanRoot of roots) {
    const absRoot = join(root, scanRoot);
    let rootStat;
    try {
      rootStat = statSync(absRoot);
    } catch {
      continue; // e.g. dist/ before a build — other targets build first
    }
    if (!rootStat.isDirectory()) continue;

    for (const file of walk(absRoot)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const ext = file.slice(file.lastIndexOf("."));
      if (!SCANNED_EXTENSIONS.has(ext)) continue;
      const relPath = file.slice(root.length + 1);
      violations.push(...scanText(relPath, readFileSync(file, "utf8"), config));
    }
  }

  return violations;
}

function main(): void {
  const root = process.cwd();
  const config: PolicyConfig = JSON.parse(
    readFileSync(join(root, "scripts/content-policy-rules.json"), "utf8"),
  );
  const violations = scanRepo(root, config);

  if (violations.length > 0) {
    console.error("content-policy: violations found\n");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.ruleId}]  ${v.excerpt}`);
    }
    console.error(
      `\n${violations.length} violation(s). See docs/content-policy.md.`,
    );
    process.exit(1);
  }
  console.log("content-policy: OK — no prohibited material found");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
