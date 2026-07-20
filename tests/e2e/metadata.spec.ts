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
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      /.+/,
    );
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      "en_GB",
    );
    await expect(page.locator('meta[name="author"]')).toHaveAttribute(
      "content",
      "Ed Chapman",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "max-image-preview:large, max-snippet:-1",
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(
      page.locator('meta[name="twitter:image:alt"]'),
    ).toHaveAttribute("content", /.+/);
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
      // On-origin without a look-alike-host hole: the bare apex (canonical is
      // slash-free) or a path under it — not a regex with unescaped dots and no
      // end anchor.
      expect(loc === ORIGIN || (loc?.startsWith(`${ORIGIN}/`) ?? false)).toBe(
        true,
      );
      if (loc !== ORIGIN) expect(loc?.endsWith("/")).toBe(false);
      expect(loc).not.toContain("404");
    }
  });

  test("note URLs carry a content-derived lastmod in the sitemap", async ({
    request,
  }) => {
    const body = await (await request.get("/sitemap-0.xml")).text();
    // The <url> block for a known note must include a valid <lastmod>.
    const block = new RegExp(
      `<url>\\s*<loc>${ORIGIN}/notes/llm-as-judge-as-a-ci-quality-gate</loc>([\\s\\S]*?)</url>`,
    ).exec(body);
    expect(block).not.toBeNull();
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block?.[1] ?? "")?.[1];
    expect(lastmod).toBeTruthy();
    expect(Number.isNaN(Date.parse(lastmod ?? ""))).toBe(false);
  });

  test("default social card is generated as a valid 1200×630 PNG", async ({
    request,
  }) => {
    const card = await request.get("/og/default.png");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toContain("image/png");

    // PNG layout: 8-byte signature, then the IHDR chunk with big-endian
    // width at byte 16 and height at byte 20.
    const body = await card.body();
    expect([...body.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
  });

  test("icon fallbacks and manifest are generated, linked, and valid", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/site.webmanifest",
    );

    const icon = await request.get("/apple-touch-icon.png");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
    const iconBody = await icon.body();
    expect([...iconBody.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(iconBody.readUInt32BE(16)).toBe(180);
    expect(iconBody.readUInt32BE(20)).toBe(180);

    const manifestResponse = await request.get("/site.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  test("project and note pages carry their own social card, and it resolves", async ({
    page,
    request,
  }) => {
    await page.goto("/projects/foreman");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${ORIGIN}/og/projects/foreman.png`,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    );

    const card = await request.get("/og/projects/foreman.png");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toContain("image/png");

    await page.goto("/notes/llm-as-judge-as-a-ci-quality-gate");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${ORIGIN}/og/notes/llm-as-judge-as-a-ci-quality-gate.png`,
    );
  });

  test("RSS feed is served, advertised, and lists published notes", async ({
    page,
    request,
  }) => {
    const feed = await request.get("/rss.xml");
    expect(feed.status()).toBe(200);
    const body = await feed.text();
    expect(body).toContain("<rss");
    expect(body).toContain(
      `<link>${ORIGIN}/notes/llm-as-judge-as-a-ci-quality-gate</link>`,
    );

    await page.goto("/");
    await expect(
      page.locator('link[rel="alternate"][type="application/rss+xml"]'),
    ).toHaveAttribute("href", "/rss.xml");
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
