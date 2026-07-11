import { execSync } from "node:child_process";

/** The /api/ask route imports src/generated/corpus.json — build it first. */
export default function setup(): void {
  execSync("node scripts/build-agent-corpus.ts", { stdio: "inherit" });
}
