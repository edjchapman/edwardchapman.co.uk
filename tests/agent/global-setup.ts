import { execSync } from "node:child_process";

/**
 * The /api/ask route imports src/generated/corpus.json and baseline.json —
 * build both before the suites run (baseline resolves against the corpus).
 */
export default function setup(): void {
  execSync("node scripts/build-agent-corpus.ts", { stdio: "inherit" });
  execSync("node scripts/build-baseline-answers.ts", { stdio: "inherit" });
}
