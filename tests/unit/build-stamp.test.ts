import { describe, expect, it } from "vitest";

import {
  buildStamp,
  parseLighthouse,
  summariseEvals,
} from "../../scripts/build-stamp";

const NOW = new Date("2026-10-28T12:00:00.000Z");

const report = {
  testResults: [
    {
      name: "/repo/tests/agent/retrieval.test.ts",
      assertionResults: [
        { status: "passed" },
        { status: "passed" },
        { status: "skipped" },
      ],
    },
    {
      name: "/repo/tests/unit/schemas.test.ts",
      assertionResults: [{ status: "passed" }],
    },
  ],
};

// ADR-0030 decision 8: every stamp value is observed, never defaulted.
describe("build stamp", () => {
  it("counts only agent-eval assertions, ignoring skips", () => {
    expect(summariseEvals(report)).toEqual({ passed: 2, total: 2 });
    expect(summariseEvals({ testResults: [] })).toBeUndefined();
  });

  it("carries sha and evals in CI", () => {
    const stamp = buildStamp(
      { CI: "true", GITHUB_SHA: "cba7957a064f80840d3feacc" },
      () => report,
      NOW,
    );
    expect(stamp).toEqual({
      builtAt: "2026-10-28T12:00:00.000Z",
      sha: "cba7957",
      evals: { passed: 2, total: 2 },
    });
  });

  it("omits sha and evals outside CI, even when a results file exists", () => {
    const stamp = buildStamp(
      { GITHUB_SHA: "cba7957a064f80840d3feacc" },
      () => report,
      NOW,
    );
    expect(stamp).toEqual({ builtAt: "2026-10-28T12:00:00.000Z" });
  });

  it("omits evals when CI has no results file", () => {
    const stamp = buildStamp({ CI: "true" }, () => undefined, NOW);
    expect(stamp).toEqual({ builtAt: "2026-10-28T12:00:00.000Z" });
  });

  it("takes Lighthouse status only with a real PR number", () => {
    expect(parseLighthouse("success", "203")).toEqual({
      conclusion: "success",
      pr: 203,
    });
    expect(parseLighthouse("success", "")).toBeUndefined();
    expect(parseLighthouse(undefined, "203")).toBeUndefined();
    expect(parseLighthouse("", "203")).toBeUndefined();
  });
});
