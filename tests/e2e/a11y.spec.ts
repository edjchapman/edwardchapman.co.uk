import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Automated accessibility checks — necessary but not sufficient; the manual
// checklist lives in the PR template. Pages are added here as they ship.
const PAGES = [
  "/",
  "/projects",
  "/projects/foreman",
  "/notes",
  "/notes/llm-as-judge-as-a-ci-quality-gate",
  // Carries the site's only ts code fence — keeps the token-mapped Shiki
  // colours under the contrast gate in both schemes.
  "/notes/api-enforced-citations",
  "/experience",
  "/now",
  "/colophon",
  "/privacy",
  "/ask",
  "/definitely-not-a-page",
];

// Dark mode is system-driven (ADR-0013), so contrast must hold in both
// schemes. Every axe scan runs under light and dark emulation.
const SCHEMES = ["light", "dark"] as const;

test.describe("accessibility", () => {
  for (const path of PAGES) {
    for (const scheme of SCHEMES) {
      test(`axe scan is clean (${scheme}): ${path}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }

  test("dark scheme applies the dark paper background", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toBe("rgb(23, 22, 20)"); // --color-paper #171614
  });

  test("dark scheme separates raised surfaces from the page", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/projects");
    const background = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector("article") as Element)
          .backgroundColor,
    );
    // --color-paper-raised #262420: the figure/ground step that 1px rules
    // alone could not carry in the dark scheme.
    expect(background).toBe("rgb(38, 36, 32)");
  });

  test("reduced motion disables the transition vocabulary", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const duration = await page.evaluate(() => {
      const pill = document.querySelector(".actions a") as Element;
      return getComputedStyle(pill).transitionDuration;
    });
    expect(duration).toBe("0s");
  });

  test("light scheme keeps the light paper background", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toBe("rgb(250, 249, 246)"); // --color-paper #faf9f6
  });

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
