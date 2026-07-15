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
    await expect(
      page.getByRole("heading", { level: 2, name: "Recent notes" }),
    ).toBeVisible();

    const contact = page.getByRole("region", { name: "Contact" });
    await expect(
      contact.getByRole("link", { name: "ed@edwardchapman.co.uk" }),
    ).toHaveAttribute("href", "mailto:ed@edwardchapman.co.uk");
  });

  test("recent notes list the three newest published notes and resolve", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Recent notes" });
    const links = section.locator(".recent-notes a");
    await expect(links).toHaveCount(3);
    await expect(
      section.getByRole("link", { name: "All notes →" }),
    ).toHaveAttribute("href", "/notes");

    const firstHref = await links.first().getAttribute("href");
    expect(firstHref).toMatch(/^\/notes\/[a-z0-9-]+$/);
    const response = await page.goto(firstHref ?? "/notes");
    expect(response?.status()).toBe(200);
  });

  test("closing pointer links live content and the ask agent, no stale copy", async ({
    page,
  }) => {
    await page.goto("/");
    const deeper = page.locator(".deeper");
    await expect(deeper.getByRole("link", { name: "colophon" })).toBeVisible();
    await expect(
      deeper.getByRole("link", { name: "case studies" }),
    ).toHaveAttribute("href", "/projects");
    await expect(deeper.getByRole("link", { name: "Ask" })).toHaveAttribute(
      "href",
      "/ask",
    );
    await expect(page.locator("body")).not.toContainText("on the way");
  });

  test("project cards link to repositories and live demos", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "Repository" }).first(),
    ).toHaveAttribute("href", /^https:\/\/github\.com\/edjchapman\//);
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
