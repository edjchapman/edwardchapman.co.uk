import { describe, expect, it } from "vitest";

import { resolveCanonical } from "../../src/lib/paths";

describe("resolveCanonical", () => {
  const origin = "https://edwardchapman.co.uk";

  it("returns the override verbatim when present", () => {
    const override = "https://example.com/original-post";
    expect(resolveCanonical(override, "/notes/copy.html", origin)).toBe(
      override,
    );
  });

  it("derives from the pathname and strips a trailing slash when no override is given", () => {
    expect(resolveCanonical(undefined, "/notes/foo/", origin)).toBe(
      `${origin}/notes/foo`,
    );
    expect(resolveCanonical(undefined, "/projects/bar.html", origin)).toBe(
      `${origin}/projects/bar`,
    );
  });

  it("preserves the root path when deriving", () => {
    expect(resolveCanonical(undefined, "/index.html", origin)).toBe(
      `${origin}/`,
    );
  });
});
