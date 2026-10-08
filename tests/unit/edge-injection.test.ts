import { describe, expect, it } from "vitest";

import {
  edgeInjectionSource,
  inlineScriptHashes,
} from "../../scripts/probe-live-security";

const injected = (path: string): string =>
  `<head><script>window.__CF$cv$params={r:'x'};var s=document.createElement('script');s.src='${path}';</script></head>`;

describe("edgeInjectionSource", () => {
  it("is null for a clean page", () => {
    expect(edgeInjectionSource("<head><script>1</script></head>")).toBeNull();
  });

  it("names Precursor from its script path", () => {
    expect(
      edgeInjectionSource(
        injected("/cdn-cgi/challenge-platform/scripts/precursor/main.js"),
      ),
    ).toMatch(/^Precursor/);
  });

  it("names JavaScript Detections from its script path", () => {
    expect(
      edgeInjectionSource(
        injected("/cdn-cgi/challenge-platform/scripts/jsd/main.js"),
      ),
    ).toMatch(/^JavaScript Detections/);
  });

  it("falls back to listing every suspect for an unknown path", () => {
    const source = edgeInjectionSource(
      injected("/cdn-cgi/challenge-platform/scripts/new-thing/main.js"),
    );
    expect(source).toMatch(/Precursor/);
    expect(source).toMatch(/JavaScript Detections/);
    expect(source).toMatch(/Bot Fight Mode/);
  });
});

describe("inlineScriptHashes", () => {
  it("hashes executable inline scripts and skips external and JSON-LD ones", async () => {
    const hashes = await inlineScriptHashes(
      '<script>a()</script><script src="/x.js"></script>' +
        '<script type="application/ld+json">{}</script>',
    );
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^sha256-/);
  });

  // CodeQL js/bad-tag-filter: browsers end a script at `</script` followed by
  // whitespace or junk attributes, so the guard must too.
  it("matches closing tags with whitespace and junk attributes", async () => {
    const hashes = await inlineScriptHashes(
      "<SCRIPT>a()</script\t\n bar><script>b()</script >",
    );
    expect(hashes).toHaveLength(2);
  });
});
