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

  test("homepage shares one left edge from header to footer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const left = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().left));
    const edge = await left("header .site-name");
    // Hero eyebrow and every section label sit on the same line (ADR-0030).
    expect(await left(".hero .eyebrow")).toBe(edge);
    for (const id of ["work", "experience", "how-i-work", "writing"]) {
      expect(await left(`#${id}`), id).toBe(edge);
    }
    // Bodies share a second line, one rail-width in.
    const body = await left(".hero h1");
    expect(body).toBeGreaterThan(edge);
    expect(await left('section[aria-labelledby="work"] .body')).toBe(body);
  });

  test("citation sources hang in the rail, inside their section", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const edge = await page
      .locator("header .site-name")
      .evaluate((el) => Math.round(el.getBoundingClientRect().left));
    const boxes = await page.locator(".footnotes").evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        const scope = el.closest("section:not(.footnotes), .hero") as Element;
        const outer = scope.getBoundingClientRect();
        const label = scope.querySelector("h2, .eyebrow") as Element;
        return {
          left: Math.round(box.left),
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          labelBottom: label.getBoundingClientRect().bottom,
          scopeBottom: outer.bottom,
          bodyLeft: (
            scope.querySelector(".body") as Element
          ).getBoundingClientRect().left,
        };
      }),
    );
    expect(boxes.length).toBe(2);
    for (const b of boxes) {
      expect(b.left).toBe(edge);
      expect(b.right).toBeLessThanOrEqual(b.bodyLeft);
      expect(b.top).toBeGreaterThan(b.labelBottom);
      expect(b.bottom).toBeLessThanOrEqual(b.scopeBottom);
    }
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
