import { describe, expect, it } from "vitest";

import {
  evaluateQuota,
  QUOTA_WINDOW_SECONDS,
  signQuotaValue,
  type QuotaOptions,
} from "../../src/lib/agent/quota";

const SECRET = "unit-test-secret";
const NOW_MS = 1_750_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const LIMIT = 3;

function quotaOptions(
  cookieHeader: string | null,
  overrides: Partial<QuotaOptions> = {},
): QuotaOptions {
  return {
    cookieHeader,
    secret: SECRET,
    limit: LIMIT,
    nowMs: NOW_MS,
    secure: true,
    ...overrides,
  };
}

/** Extracts {windowStartSec, count} from a Set-Cookie string. */
function parseSetCookie(setCookie: string): {
  windowStartSec: number;
  count: number;
} {
  const match = /ask_quota=v1\.(\d+)\.(\d+)\./.exec(setCookie);
  expect(match).not.toBeNull();
  return {
    windowStartSec: Number(match?.[1]),
    count: Number(match?.[2]),
  };
}

async function mintedHeader(
  windowStartSec: number,
  count: number,
  secret = SECRET,
): Promise<string> {
  return `ask_quota=${await signQuotaValue(windowStartSec, count, secret)}`;
}

describe("evaluateQuota (ADR-0024)", () => {
  it("starts a fresh window with count 1 and the full attribute set", async () => {
    const decision = await evaluateQuota(quotaOptions(null));
    expect(decision.allowed).toBe(true);
    expect(decision.setCookie).toContain("Max-Age=86400");
    expect(decision.setCookie).toContain("Path=/api/ask");
    expect(decision.setCookie).toContain("HttpOnly");
    expect(decision.setCookie).toContain("SameSite=Strict");
    expect(decision.setCookie).toContain("Secure");
    expect(parseSetCookie(decision.setCookie ?? "")).toEqual({
      windowStartSec: NOW_SEC,
      count: 1,
    });
  });

  it("omits Secure for local (loopback) requests", async () => {
    const decision = await evaluateQuota(quotaOptions(null, { secure: false }));
    expect(decision.setCookie).not.toContain("Secure");
    expect(decision.setCookie).toContain("HttpOnly");
  });

  it("increments a valid in-window cookie, keeping the window start", async () => {
    const start = NOW_SEC - 100;
    const decision = await evaluateQuota(
      quotaOptions(await mintedHeader(start, 1)),
    );
    expect(decision.allowed).toBe(true);
    expect(parseSetCookie(decision.setCookie ?? "")).toEqual({
      windowStartSec: start,
      count: 2,
    });
  });

  it("denies at the limit without refreshing the cookie", async () => {
    const decision = await evaluateQuota(
      quotaOptions(await mintedHeader(NOW_SEC - 100, LIMIT)),
    );
    expect(decision).toEqual({ allowed: false });
  });

  it("resets an expired window instead of denying", async () => {
    const expiredStart = NOW_SEC - QUOTA_WINDOW_SECONDS - 1;
    const decision = await evaluateQuota(
      quotaOptions(await mintedHeader(expiredStart, LIMIT)),
    );
    expect(decision.allowed).toBe(true);
    expect(parseSetCookie(decision.setCookie ?? "")).toEqual({
      windowStartSec: NOW_SEC,
      count: 1,
    });
  });

  it("treats a future-dated window as fresh", async () => {
    const decision = await evaluateQuota(
      quotaOptions(await mintedHeader(NOW_SEC + 600, LIMIT)),
    );
    expect(decision.allowed).toBe(true);
    expect(parseSetCookie(decision.setCookie ?? "").count).toBe(1);
  });

  it("treats a tampered signature as a fresh visitor", async () => {
    const valid = await signQuotaValue(NOW_SEC - 100, LIMIT, SECRET);
    const flipped = valid.endsWith("A")
      ? `${valid.slice(0, -1)}B`
      : `${valid.slice(0, -1)}A`;
    const decision = await evaluateQuota(quotaOptions(`ask_quota=${flipped}`));
    expect(decision.allowed).toBe(true);
    expect(parseSetCookie(decision.setCookie ?? "").count).toBe(1);
  });

  it("treats a cookie signed with a different secret as fresh", async () => {
    const decision = await evaluateQuota(
      quotaOptions(await mintedHeader(NOW_SEC - 100, LIMIT, "other-secret")),
    );
    expect(decision.allowed).toBe(true);
  });

  it.each([
    ["garbage", "ask_quota=garbage"],
    ["missing parts", "ask_quota=v1.123.4"],
    ["wrong version", "ask_quota=v2.123.4.abc"],
    ["non-numeric window", "ask_quota=v1.abc.4.abc"],
    ["oversized count", "ask_quota=v1.123.12345.abc"],
  ])("treats a malformed cookie (%s) as fresh", async (_label, header) => {
    const decision = await evaluateQuota(quotaOptions(header));
    expect(decision.allowed).toBe(true);
    expect(parseSetCookie(decision.setCookie ?? "").count).toBe(1);
  });

  it("finds its cookie among others in the header", async () => {
    const minted = await signQuotaValue(NOW_SEC - 100, LIMIT, SECRET);
    const decision = await evaluateQuota(
      quotaOptions(`theme=dark; ask_quota=${minted}; other=1`),
    );
    expect(decision).toEqual({ allowed: false });
  });
});
