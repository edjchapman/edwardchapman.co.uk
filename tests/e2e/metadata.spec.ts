import { expect, test } from "@playwright/test";

const ORIGIN = "https://edwardchapman.co.uk";

test.describe("metadata", () => {
  test("canonical URLs are absolute, on-origin, and slash-free", async ({
    page,
  }) => {
    await page.goto("/colophon");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", `${ORIGIN}/colophon`);

    await page.goto("/");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${ORIGIN}/`,
    );
  });

  test("Open Graph and Twitter card metadata are complete and absolute", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${ORIGIN}/og/default.png`,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${ORIGIN}/`,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute("content", /.+/);
  });

  test("sitemap is served, canonical, slash-free, and excludes 404", async ({
    request,
  }) => {
    const index = await request.get("/sitemap-index.xml");
    expect(index.status()).toBe(200);
    const indexBody = await index.text();
    const [, sitemapPath] = /<loc>[^<]*?(\/sitemap-\d+\.xml)<\/loc>/.exec(
      indexBody,
    ) ?? [undefined, "/sitemap-0.xml"];

    const sitemap = await request.get(sitemapPath ?? "/sitemap-0.xml");
    expect(sitemap.status()).toBe(200);
    const body = await sitemap.text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    expect(locs.length).toBeGreaterThanOrEqual(3);
    for (const loc of locs) {
      expect(loc).toMatch(new RegExp(`^${ORIGIN}`));
      if (loc !== `${ORIGIN}/`) expect(loc?.endsWith("/")).toBe(false);
      expect(loc).not.toContain("404");
    }
  });

  test("robots.txt advertises the sitemap", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain(
      "Sitemap: https://edwardchapman.co.uk/sitemap-index.xml",
    );
  });

  test("llms.txt is served and points at published content", async ({
    request,
  }) => {
    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    const body = await llms.text();
    expect(body).toContain("edwardchapman.co.uk");
    expect(body).toContain("Foreman");
  });
});
