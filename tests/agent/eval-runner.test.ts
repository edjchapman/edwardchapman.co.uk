import { describe, expect, it } from "vitest";

import { readEvalEnv } from "../../scripts/run-agent-evals";

// Live evals stay off the production AI Gateway (ADR-0025 activation record).
describe("readEvalEnv", () => {
  it("accepts the direct-API environment", () => {
    expect(readEvalEnv({ ANTHROPIC_API_KEY: "sk-test" })).toEqual({
      ok: true,
      apiKey: "sk-test",
    });
  });

  it("requires an API key", () => {
    expect(readEvalEnv({})).toEqual({
      ok: false,
      problem: expect.stringMatching(/ANTHROPIC_API_KEY is required/),
    });
  });

  it("refuses a base URL rather than calling through the gateway", () => {
    expect(
      readEvalEnv({
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_BASE_URL:
          "https://gateway.ai.cloudflare.com/v1/acct/edwardchapman-ask/anthropic",
      }),
    ).toEqual({
      ok: false,
      problem: expect.stringMatching(/ANTHROPIC_BASE_URL must be unset/),
    });
  });

  it.each(["", "   "])("treats a blank base URL (%j) as unset", (blank) => {
    expect(
      readEvalEnv({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: blank }),
    ).toMatchObject({ ok: true });
  });
});
