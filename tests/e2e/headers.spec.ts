import { expect, test } from "@playwright/test";

// Security headers ship via public/_headers (applied by the Static Assets
// layer — wrangler dev applies it locally too) and in Worker route code.
test.describe("security headers", () => {
  test("HTML responses carry the security header set", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    // The web manifest needs an explicit source — default-src 'none' would
    // otherwise block <link rel="manifest"> (see public/_headers).
    expect(headers["content-security-policy"]).toContain("manifest-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  // The strict CSP is a load-bearing control (it is what blocked Cloudflare's
  // edge-injected challenge script on 2026-07-21). Lock its posture here so a
  // code-side weakening fails PR CI, before deploy; the live probe
  // (scripts/probe-live-security.ts) catches edge-side drift after deploy.
  test("script-src stays strict — hashes, no unsafe-inline/eval", async ({
    request,
  }) => {
    const csp =
      (await request.get("/")).headers()["content-security-policy"] ?? "";
    const scriptSrc = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // At least one pinned hash carries the Astro island bootstrap.
    expect(scriptSrc).toContain("'sha256-");
  });

  // Retired ad-tech opt-out tokens (FLoC/Privacy Sandbox) are unrecognised by
  // current browsers — each logs a console warning and signals a stale policy.
  test("permissions-policy carries no retired ad-tech tokens", async ({
    request,
  }) => {
    const pp = (await request.get("/")).headers()["permissions-policy"] ?? "";
    for (const token of [
      "interest-cohort",
      "browsing-topics",
      "run-ad-auction",
      "attribution-reporting",
      "private-aggregation",
    ]) {
      expect(pp).not.toContain(token);
    }
  });

  test("the CSP does not break rendering (styles still apply)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    const bodyFont = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(bodyFont.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // Note: a normal page load does not fetch the web manifest (browsers do
    // that lazily for install prompts), so a manifest CSP block would not
    // surface here — Lighthouse catches it by actively fetching the manifest.
    // The deterministic guard is the header-level manifest-src assertion above.
  });

  test("worker routes set their own hardening headers", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
});
