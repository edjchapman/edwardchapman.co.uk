import { expect, test } from "@playwright/test";

const NOTE = "/notes/llm-as-judge-as-a-ci-quality-gate";

test.describe("notes", () => {
  test("index lists the seed note with date and description", async ({
    page,
  }) => {
    await page.goto("/notes");
    const link = page.getByRole("link", {
      name: "LLM-as-judge as a CI quality gate",
    });
    await expect(link).toHaveAttribute("href", NOTE);
    await expect(page.locator("time").first()).toBeVisible();
  });

  test("note renders with Article JSON-LD and related project link", async ({
    page,
  }) => {
    await page.goto(NOTE);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "LLM-as-judge",
    );

    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Article");
    expect(parsed["datePublished"]).toBeTruthy();

    await expect(
      page.getByRole("complementary", { name: "Related project" }),
    ).toContainText("AI Due-Diligence Assistant");
  });

  test("related writing appears on the linked project page", async ({
    page,
  }) => {
    await page.goto("/projects/ai-due-diligence-assistant");
    await expect(
      page.getByRole("complementary", { name: "Related writing" }),
    ).toContainText("LLM-as-judge as a CI quality gate");
  });

  test("og:type is article on notes", async ({ page }) => {
    await page.goto(NOTE);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    );
  });
});
