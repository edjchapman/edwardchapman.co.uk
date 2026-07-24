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

  test("index card titles are level-2 headings under the page h1", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { level: 2, name: "Foreman" }),
    ).toBeVisible();
    expect(await page.getByRole("heading", { level: 3 }).count()).toBe(0);
  });

  test("index carries CollectionPage JSON-LD listing the published projects", async ({
    page,
  }) => {
    await page.goto("/projects");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as {
      "@graph": Record<string, unknown>[];
    };
    const collection = parsed["@graph"].find(
      (n) => n["@type"] === "CollectionPage",
    );
    const list = collection?.["mainEntity"] as Record<string, unknown>;
    expect(list["@type"]).toBe("ItemList");
    const items = list["itemListElement"] as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    expect(items[0]?.["url"]).toBe(
      "https://edwardchapman.co.uk/projects/foreman",
    );
    // ADR-0017: index pages carry no breadcrumb structure.
    expect(parsed["@graph"].some((n) => n["@type"] === "BreadcrumbList")).toBe(
      false,
    );
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

  test("case study carries SoftwareSourceCode + breadcrumb JSON-LD", async ({
    page,
  }) => {
    await page.goto("/projects/foreman");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as {
      "@graph": Record<string, unknown>[];
    };
    const nodes = parsed["@graph"];
    const code = nodes.find((n) => n["@type"] === "SoftwareSourceCode");
    expect(code?.["codeRepository"]).toMatch(/^https:\/\/github\.com\//);
    expect(code?.["programmingLanguage"]).toBeUndefined();
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
  });
});
