import { expect, test } from "@playwright/test";

// The wide-canvas layout (ADR-0028): a breakout grid on main gives every
// page a 65ch reading column with a wide track structural elements opt
// into. Desktop assertions here; the 390px column behaviour is pinned in
// smoke.spec.ts.
const DESKTOP = { width: 1280, height: 800 };

test.describe("wide-canvas layout", () => {
  test("main carries the breakout grid", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const display = await page.evaluate(
      () => getComputedStyle(document.querySelector("main") as Element).display,
    );
    expect(display).toBe("grid");
  });

  test("projects index lays cards three abreast on desktop", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/projects");
    const columns = await page.evaluate(() => {
      const grid = document.querySelector(".card-grid") as Element;
      return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    });
    expect(columns).toBe(3);
  });

  test("card grid stacks to a single column on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    const columns = await page.evaluate(() => {
      const grid = document.querySelector(".card-grid") as Element;
      return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    });
    expect(columns).toBe(1);
  });

  test("desktop viewports never scroll horizontally", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    for (const path of ["/", "/projects", "/notes"]) {
      await page.goto(path);
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth, `${path} overflows horizontally`).toBeLessThanOrEqual(
        DESKTOP.width,
      );
    }
  });
});
