import { expect, test } from "@playwright/test";

test.describe("projects", () => {
  test("index lists all published projects with case-study links", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(page.locator("article")).toHaveCount(3);
    await expect(
      page.getByRole("link", { name: "Case study" }).first(),
    ).toHaveAttribute("href", "/projects/foreman");
  });

  test("navigation reaches a case study from the homepage", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Projects" })
      .click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("link", { name: "Case study" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Foreman");
  });

  test("case studies include the mandatory judgement sections", async ({
    page,
  }) => {
    for (const slug of [
      "foreman",
      "ai-due-diligence-assistant",
      "claude-code-config",
    ]) {
      await page.goto(`/projects/${slug}`);
      await expect(
        page.getByRole("heading", { name: "Current limitations" }),
      ).toBeVisible();
      await expect(
        // Smart quotes: the renderer turns ' into ’ — match either.
        page.getByRole("heading", { name: /What I.d do next/ }),
      ).toBeVisible();
    }
  });

  test("case-study canonical is slash-free and exact", async ({ page }) => {
    await page.goto("/projects/foreman");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://edwardchapman.co.uk/projects/foreman",
    );
  });
});
