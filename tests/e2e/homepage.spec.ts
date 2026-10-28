import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("shows the 30-second scan: hero, actions, three projects, sections", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ed Chapman",
    );

    const actions = page.getByRole("list", { name: "Primary links" });
    await expect(
      actions.getByRole("link", { name: "Read the case studies" }),
    ).toHaveAttribute("href", "/projects");
    await expect(
      actions.getByRole("link", { name: "Ask about Ed's work" }),
    ).toHaveAttribute("href", "/ask");
    await expect(
      actions.getByRole("link", { name: "ed@edwardchapman.co.uk" }),
    ).toHaveAttribute("href", "mailto:ed@edwardchapman.co.uk");

    await expect(page.locator("article")).toHaveCount(3);
    for (const name of [
      "Foreman",
      "AI Due-Diligence Assistant",
      "claude-code-config",
    ]) {
      await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
    }

    for (const name of [
      "Selected work",
      "Experience",
      "How I work",
      "Writing",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
  });

  test("trims what ADR-0030 moved off the homepage", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Technical focus", "Contact", "Availability"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toHaveCount(
        0,
      );
    }
    await expect(page.locator(".deeper")).toHaveCount(0);
    await expect(page.getByRole("complementary")).toHaveCount(0);
  });

  test("experience lists every employer and links to the full page", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Experience" });
    for (const org of ["Built AI", "Kraken Technologies", "Natoora"]) {
      await expect(section).toContainText(org);
    }
    await expect(
      section.getByRole("link", { name: /Full experience/ }),
    ).toHaveAttribute("href", "/experience");
  });

  test("writing lists the three newest published notes and resolves", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Writing" });
    const links = section.locator(".notes a");
    await expect(links).toHaveCount(3);
    await expect(
      section.getByRole("link", { name: "All notes →" }),
    ).toHaveAttribute("href", "/notes");

    const firstHref = await links.first().getAttribute("href");
    expect(firstHref).toMatch(/^\/notes\/[a-z0-9-]+$/);
    const response = await page.goto(firstHref ?? "/notes");
    expect(response?.status()).toBe(200);
  });

  test("project rows link to case studies, demos and repositories", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /case study$/ })).toHaveCount(
      3,
    );
    await expect(page.getByRole("link", { name: "Live demo" })).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: "Repository" }),
    ).toHaveAttribute("href", /^https:\/\/github\.com\/edjchapman\//);
  });

  test("every project row leads with one evidence line", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("article .figure")).toHaveCount(3);
    const foreman = page.locator("article", { hasText: "Foreman" });
    await expect(foreman.locator(".figure")).toHaveText("1.84s → 0.34s");
  });

  test("Foreman's before → after is drawn to one scale", async ({ page }) => {
    await page.goto("/");
    const bars = page
      .locator("article", { hasText: "Foreman" })
      .locator(".bars");
    await expect(bars).toHaveAttribute("aria-label", /before 1.84, after 0.34/);
    const [before, after] = await bars
      .locator(".fill")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect((after ?? 0) / (before ?? 1)).toBeCloseTo(0.34 / 1.84, 2);
  });

  test("JSON-LD @graph carries a valid Person, WebSite, and ProfilePage", async ({
    page,
  }) => {
    await page.goto("/");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as {
      "@graph": Record<string, unknown>[];
    };
    const nodes = parsed["@graph"];
    const person = nodes.find((n) => n["@type"] === "Person");
    expect(person?.["name"]).toBe("Ed Chapman");
    expect(person?.["sameAs"]).toContain("https://github.com/edjchapman");
    expect(person?.["sameAs"]).toContain("https://x.com/edjchapman");
    expect(nodes.some((n) => n["@type"] === "WebSite")).toBe(true);
    const profilePage = nodes.find((n) => n["@type"] === "ProfilePage");
    expect(profilePage?.["mainEntity"]).toEqual({ "@id": person?.["@id"] });
  });

  test("full scan renders without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("article")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { level: 2, name: "Selected work" }),
    ).toBeVisible();
    await context.close();
  });
});
