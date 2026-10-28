/**
 * Build stamp (ADR-0030 decision 8): the footer's one line of real build
 * state, written to src/generated/build-stamp.json before `astro build`.
 *
 * Every value comes from the build that is running, never a default — a
 * value that isn't available is omitted:
 * - builtAt     always: this build's clock.
 * - sha         GITHUB_SHA (CI only; a local tree may be dirty).
 * - evals       the agent-eval results `make test` wrote moments earlier in
 *               the same `make check` (CI only, so a stale local file can't
 *               leak into a build).
 * - lighthouse  the "lighthouse budgets" conclusion on the PR that produced
 *               this commit, passed in by the deploy workflow.
 *
 * Runs under plain Node (erasable-syntax TypeScript only).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface EvalSummary {
  readonly passed: number;
  readonly total: number;
}

export interface LighthouseStatus {
  readonly conclusion: string;
  readonly pr: number;
}

export interface BuildStamp {
  readonly builtAt: string;
  readonly sha?: string;
  readonly evals?: EvalSummary;
  readonly lighthouse?: LighthouseStatus;
}

interface VitestJson {
  testResults?: {
    name?: string;
    assertionResults?: { status?: string }[];
  }[];
}

export const VITEST_RESULTS = ".cache/vitest-results.json";

/** Count the agent-eval assertions (tests/agent) in a vitest JSON report. */
export function summariseEvals(report: VitestJson): EvalSummary | undefined {
  let passed = 0;
  let total = 0;
  for (const file of report.testResults ?? []) {
    if (!file.name?.includes("/tests/agent/")) continue;
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === "skipped" || assertion.status === "todo") {
        continue;
      }
      total += 1;
      if (assertion.status === "passed") passed += 1;
    }
  }
  return total > 0 ? { passed, total } : undefined;
}

export function parseLighthouse(
  conclusion: string | undefined,
  pr: string | undefined,
): LighthouseStatus | undefined {
  const number = Number(pr);
  if (!conclusion || !Number.isInteger(number) || number <= 0) return undefined;
  return { conclusion, pr: number };
}

export function buildStamp(
  env: Readonly<Record<string, string | undefined>>,
  readReport: () => VitestJson | undefined,
  now: Date,
): BuildStamp {
  const ci = env["CI"] === "true";
  const sha = ci ? env["GITHUB_SHA"]?.slice(0, 7) : undefined;
  const report = ci ? readReport() : undefined;
  const evals = report ? summariseEvals(report) : undefined;
  const lighthouse = parseLighthouse(
    env["LIGHTHOUSE_CONCLUSION"],
    env["LIGHTHOUSE_PR"],
  );
  return {
    builtAt: now.toISOString(),
    ...(sha ? { sha } : {}),
    ...(evals ? { evals } : {}),
    ...(lighthouse ? { lighthouse } : {}),
  };
}

function main(): void {
  const root = process.cwd();
  const reportPath = join(root, VITEST_RESULTS);
  const stamp = buildStamp(
    process.env,
    () =>
      existsSync(reportPath)
        ? (JSON.parse(readFileSync(reportPath, "utf8")) as VitestJson)
        : undefined,
    new Date(),
  );
  mkdirSync(join(root, "src/generated"), { recursive: true });
  writeFileSync(
    join(root, "src/generated/build-stamp.json"),
    `${JSON.stringify(stamp, null, 2)}\n`,
  );
  const parts = Object.keys(stamp).join(", ");
  console.log(`build-stamp: OK — ${parts}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
