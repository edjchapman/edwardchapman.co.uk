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

  test("index carries CollectionPage JSON-LD listing the published notes", async ({
    page,
  }) => {
    await page.goto("/notes");
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
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(
      items.some((i) => i["url"] === `https://edwardchapman.co.uk${NOTE}`),
    ).toBe(true);
  });

  test("note renders with BlogPosting + breadcrumb JSON-LD and a related project link", async ({
    page,
  }) => {
    await page.goto(NOTE);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "LLM-as-judge",
    );

    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const parsed = JSON.parse(raw ?? "{}") as {
      "@graph": Record<string, unknown>[];
    };
    const nodes = parsed["@graph"];
    const post = nodes.find((n) => n["@type"] === "BlogPosting");
    expect(post?.["datePublished"]).toBeTruthy();
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);

    // The author reference must resolve to a named Person on this same page,
    // not only on the homepage — Google resolves @id within a page.
    const authorId = (post?.["author"] as { "@id"?: string })?.["@id"];
    const person = nodes.find((n) => n["@type"] === "Person");
    expect(person?.["@id"]).toBe(authorId);
    expect(person?.["name"]).toBe("Ed Chapman");

    await expect(
      page.getByRole("complementary", { name: "Related project" }),
    ).toContainText("AI Due-Diligence Assistant");
  });

  test("note shows a breadcrumb trail and related notes by shared tag", async ({
    page,
  }) => {
    await page.goto(NOTE);

    const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumb.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(crumb.getByRole("link", { name: "Notes" })).toHaveAttribute(
      "href",
      "/notes",
    );

    const related = page.getByRole("complementary", { name: "Related notes" });
    const links = related.getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    // Every related note is a real note route, never this one.
    for (const href of await links.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    )) {
      expect(href).toMatch(/^\/notes\/[a-z0-9-]+$/);
      expect(href).not.toBe(NOTE);
    }
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
