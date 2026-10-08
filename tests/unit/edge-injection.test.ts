import { describe, expect, it } from "vitest";

import { edgeInjectionSource } from "../../scripts/probe-live-security";

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
