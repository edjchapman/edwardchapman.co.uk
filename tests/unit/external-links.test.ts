import { describe, expect, it } from "vitest";

import { extractExternalUrls } from "../../scripts/check-external-links";

describe("extractExternalUrls", () => {
  it("extracts external URLs and ignores the canonical origin", () => {
    const urls = extractExternalUrls(
      "See https://github.com/edjchapman and https://edwardchapman.co.uk/notes.",
    );
    expect(urls).toEqual(["https://github.com/edjchapman"]);
  });

  it("ignores bare scheme mentions in code spans", () => {
    const urls = extractExternalUrls(
      "remote CSV sources (`s3://`, `https://`) behind the ingest seam",
    );
    expect(urls).toEqual([]);
  });

  it("trims trailing punctuation", () => {
    const urls = extractExternalUrls("Try https://example.com/docs.");
    expect(urls).toEqual(["https://example.com/docs"]);
  });
});
