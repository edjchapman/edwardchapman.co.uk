import { expect, test } from "@playwright/test";

test.describe("experience page", () => {
  test("serves with a single h1 and the role sections", async ({ page }) => {
    const response = await page.goto("/experience");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Experience",
    );
    for (const heading of [
      "Built AI",
      "Kraken Technologies (Octopus Energy Group)",
      "Natoora",
      "Education",
      "Technology depth",
      "Strengths and leadership",
      "Availability",
    ]) {
      await expect(
        page.getByRole("heading", { level: 2, name: heading }),
      ).toBeVisible();
    }
  });

  test("separates the skills document from the experience timeline", async ({
    page,
  }) => {
    await page.goto("/experience");
    const skills = page.locator("div.skills");
    await expect(skills).toBeVisible();
    await expect(
      skills.getByRole("heading", { level: 2, name: "Technology depth" }),
    ).toBeVisible();
  });

  test("is linked from the site nav with aria-current set", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Site" });
    await nav.getByRole("link", { name: "Experience" }).click();
    await expect(page).toHaveURL(/\/experience$/);
    await expect(
      page
        .getByRole("navigation", { name: "Site" })
        .getByRole("link", { name: "Experience" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("renders fully without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto("/experience");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 2, name: "Natoora" }),
    ).toBeVisible();
    await context.close();
  });

  test("carries the canonical URL and appears in the sitemap", async ({
    page,
    request,
  }) => {
    await page.goto("/experience");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://edwardchapman.co.uk/experience",
    );
    const sitemap = await request.get("/sitemap-0.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(
      "https://edwardchapman.co.uk/experience",
    );
  });

  test("enriches the Person JSON-LD with alumniOf and occupation", async ({
    page,
  }) => {
    await page.goto("/experience");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as {
      "@graph": Record<string, unknown>[];
    };
    const person = parsed["@graph"].find((node) => node["@type"] === "Person");
    expect(person).toBeDefined();
    expect(person?.["alumniOf"]).toEqual([
      {
        "@type": "EducationalOrganization",
        name: "Birkbeck, University of London",
      },
      { "@type": "EducationalOrganization", name: "University of Leeds" },
    ]);
    expect(person?.["hasOccupation"]).toEqual({
      "@type": "Occupation",
      name: "Senior Software & Platform Engineer",
    });
    expect(person?.["worksFor"]).toBeUndefined();
  });

  test("never carries prohibited vocabulary", async ({ page }) => {
    await page.goto("/experience");
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toContain("£");
    expect(body.toLowerCase()).not.toContain("salary");
    expect(body.toLowerCase()).not.toContain("career-portfolio");
  });
});
