import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("shows the 30-second scan: hero, actions, three project cards, sections", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ed Chapman",
    );

    const actions = page.getByRole("list", { name: "Primary links" });
    await expect(actions.getByRole("link", { name: "GitHub" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "LinkedIn" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:ed@edwardchapman.co.uk",
    );

    await expect(page.locator("article")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { level: 3, name: "Foreman" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "AI Due-Diligence Assistant",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "claude-code-config" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { level: 2, name: "How I work" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Technical focus" }),
    ).toBeVisible();
  });

  test("project cards link to repositories and live demos", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "Repository" }).first(),
    ).toHaveAttribute("href", /github\.com\/edjchapman/);
    await expect(page.getByRole("link", { name: "Live demo" })).toHaveCount(2);
  });

  test("JSON-LD Person schema is valid", async ({ page }) => {
    await page.goto("/");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Person");
    expect(parsed["name"]).toBe("Ed Chapman");
    expect(parsed["sameAs"]).toContain("https://github.com/edjchapman");
  });

  test("full scan renders without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("article")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { level: 2, name: "Selected projects" }),
    ).toBeVisible();
    await context.close();
  });
});
