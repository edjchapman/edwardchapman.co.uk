import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sanitizeBuildOutput } from "../../scripts/sanitize-build-output";

let testDirectory: string;

beforeEach(async () => {
  // mkdtemp appends random characters and creates the directory atomically, so
  // there is no predictable path a local attacker could pre-seed or symlink
  // (CodeQL js/insecure-temporary-file).
  testDirectory = await mkdtemp(join(tmpdir(), "ed-build-output-"));
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

/**
 * Minimal JSONC → JSON: drops `//` and block comments and trailing commas
 * while ignoring comment-like or comma-like sequences inside string literals.
 * Enough to parse the repo's small, controlled `wrangler.jsonc` structurally
 * without adding a dependency.
 */
function parseJsonc(source: string): unknown {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
    } else if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
    } else if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === "/" && next === "/") {
      inLine = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

describe("build-output sanitization", () => {
  it("removes Cloudflare's generated preview variables without reading them", async () => {
    const serverDirectory = join(testDirectory, "server");
    await mkdir(serverDirectory, { recursive: true });
    const previewVars = join(serverDirectory, ".dev.vars");
    await writeFile(previewVars, "PLACEHOLDER_SECRET=test-only\n");

    await sanitizeBuildOutput(testDirectory);

    await expect(access(previewVars)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects any other local environment file left in the build", async () => {
    const clientDirectory = join(testDirectory, "client");
    await mkdir(clientDirectory, { recursive: true });
    await writeFile(join(clientDirectory, ".env.local"), "TEST_ONLY=value\n");

    await expect(sanitizeBuildOutput(testDirectory)).rejects.toThrow(
      "client/.env.local",
    );
  });

  it("does not define the fake-adapter binding in the deploy configuration", async () => {
    const config = parseJsonc(await readFile("wrangler.jsonc", "utf8")) as {
      vars?: Record<string, unknown>;
    };
    expect(config.vars ?? {}).not.toHaveProperty("ASK_MODEL_MODE");
  });
});
