import { describe, expect, it } from "vitest";

import { evalEnvProblem } from "../../scripts/run-agent-evals";

/**
 * Live evals call the Anthropic API directly (ADR-0025, issue #162): the
 * production gateway is authenticated and rate-limited for visitors, and the
 * runner never sends its token, so a gateway base URL would fail every call.
 */
describe("evalEnvProblem", () => {
  it("accepts the direct-API environment", () => {
    expect(evalEnvProblem({ ANTHROPIC_API_KEY: "sk-test" })).toBeNull();
  });

  it("requires an API key", () => {
    expect(evalEnvProblem({})).toMatch(/ANTHROPIC_API_KEY is required/);
  });

  it("refuses a base URL rather than calling through the gateway", () => {
    expect(
      evalEnvProblem({
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_BASE_URL:
          "https://gateway.ai.cloudflare.com/v1/acct/edwardchapman-ask/anthropic",
      }),
    ).toMatch(/ANTHROPIC_BASE_URL must be unset/);
  });

  it("treats an empty base URL as unset", () => {
    expect(
      evalEnvProblem({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: "" }),
    ).toBeNull();
  });
});
