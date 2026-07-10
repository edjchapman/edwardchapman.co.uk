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
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-frame-options"]).toBe("DENY");
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
  });

  test("worker routes set their own hardening headers", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
});
