/**
 * Remove Cloudflare's preview-only local variables from the production build
 * and fail if any local environment file remains (ADR-0018). File contents are
 * never read or printed.
 */

import { readdir, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function isLocalEnvironmentFile(name: string): boolean {
  return (
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name === ".env" ||
    name.startsWith(".env.")
  );
}

async function findLocalEnvironmentFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findLocalEnvironmentFiles(path)));
    } else if (entry.isFile() && isLocalEnvironmentFile(entry.name)) {
      matches.push(path);
    }
  }

  return matches;
}

export async function sanitizeBuildOutput(
  distDirectory = resolve("dist"),
): Promise<void> {
  const generatedPreviewVars = join(distDirectory, "server", ".dev.vars");
  try {
    await unlink(generatedPreviewVars);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

  const remaining = await findLocalEnvironmentFiles(distDirectory);
  if (remaining.length > 0) {
    throw new Error(
      `build output contains local environment files: ${remaining
        .map((path) => relative(distDirectory, path))
        .join(", ")}`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await sanitizeBuildOutput();
  console.log("Build output contains no local environment files.");
}
