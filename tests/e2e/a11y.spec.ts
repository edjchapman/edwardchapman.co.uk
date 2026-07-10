import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Automated accessibility checks — necessary but not sufficient; the manual
// checklist lives in the PR template. Pages are added here as they ship.
const PAGES = ["/", "/colophon", "/privacy", "/definitely-not-a-page"];

test.describe("accessibility", () => {
  for (const path of PAGES) {
    test(`axe scan is clean: ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("landmarks are present and unique on the homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(1);
  });

  test("keyboard: skip link jumps focus to main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to main content");
    await page.keyboard.press("Enter");
    expect(page.url()).toContain("#main");
  });

  test("heading hierarchy starts at a single h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
