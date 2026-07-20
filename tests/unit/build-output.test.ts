import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sanitizeBuildOutput } from "../../scripts/sanitize-build-output";

const testDirectory = join(tmpdir(), `ed-build-output-${process.pid}`);

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

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

  it("does not enable the fake adapter in the deploy configuration", async () => {
    const wranglerConfig = await readFile("wrangler.jsonc", "utf8");
    expect(wranglerConfig).not.toContain("ASK_MODEL_MODE");
  });
});
