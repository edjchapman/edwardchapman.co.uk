import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("homepage serves with the expected heading", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Ed Chapman",
    );
  });

  test("homepage renders fully without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Ed Chapman",
    );
    await context.close();
  });

  test("homepage produces no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    expect(errors).toEqual([]);
  });

  test("unknown URLs return the authored 404 page with status 404", async ({
    page,
  }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Page not found",
    );
    await expect(page.getByRole("link", { name: /homepage/i })).toBeVisible();
  });

  test("/api/health reports the build and forbids caching", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(typeof body["version"]).toBe("string");
  });

  test("skip link is the first focusable element and moves focus to #main", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("href", "#main");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toBe("main");
  });

  test("mobile viewport keeps every nav item visible and usable", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Site" });
    for (const label of [
      "Projects",
      "Notes",
      "Experience",
      "Now",
      "Ask",
      "Colophon",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeInViewport();
    }
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(390);
    await nav.getByRole("link", { name: "Colophon" }).click();
    await expect(page).toHaveURL(/\/colophon$/);
    await context.close();
  });

  test("robots.txt and favicon are served from assets", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("User-agent");

    const favicon = await request.get("/favicon.svg");
    expect(favicon.status()).toBe(200);
    // The accent-tick mark is path-true (ADR-0021): glyphs as vector paths,
    // never live <text> whose rendering depends on the viewer's fonts.
    const svg = await favicon.text();
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    expect(svg).toContain("#e89a6b"); // the accent tick, from the palette
  });
});
