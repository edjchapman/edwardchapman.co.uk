import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The ask interface with a mocked backend (spec §15): submission, loading,
// answer + source rendering, failure states, and the unadvertised posture.
test.describe("/ask interface", () => {
  test("is unadvertised: no nav link, noindex, absent from sitemap", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Site" }).getByRole("link", {
        name: "Ask",
      }),
    ).toHaveCount(0);

    await page.goto("/ask");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );

    const sitemap = await request.get("/sitemap-0.xml");
    expect(await sitemap.text()).not.toContain("/ask");
  });

  test("submits a question and renders the answer with source links", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "Foreman uses a transactional outbox.",
          sources: [
            {
              title: "Foreman — Architecture",
              url: "https://edwardchapman.co.uk/projects/foreman",
            },
          ],
          requestId: "test-request",
        }),
      });
    });

    await page.goto("/ask");
    await page
      .getByLabel("Your question")
      .fill("How did Foreman handle reliable event processing?");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("transactional outbox");
    await expect(
      status.getByRole("link", { name: "Foreman — Architecture" }),
    ).toHaveAttribute("href", "https://edwardchapman.co.uk/projects/foreman");
    await expect(status).toContainText("Generated from published site content");
  });

  test("shows the loading state while a request is in flight", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Done.", sources: [], requestId: "t" }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("status")).toContainText("Looking through");
    await expect(page.getByRole("button", { name: "Asking…" })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Done.");
  });

  test("renders API errors as a friendly message", async ({ page }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "rate_limited",
            message:
              "Too many questions right now — please try again in a minute.",
          },
          requestId: "t",
        }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Too many questions right now",
    );
  });

  test("example questions submit on click", async ({ page }) => {
    let received = "";
    await page.route("**/api/ask", async (route) => {
      received = route.request().postDataJSON()?.question ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Ok.", sources: [], requestId: "t" }),
      });
    });

    await page.goto("/ask");
    await page
      .getByRole("button", {
        name: "How did Foreman handle reliable event processing?",
      })
      .click();
    await expect(page.getByRole("status")).toContainText("Ok.");
    expect(received).toContain("Foreman");
  });

  test("axe scan is clean", async ({ page }) => {
    await page.goto("/ask");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("no-JS fallback explains and links the published pages", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/ask");
    await expect(page.locator("noscript")).toHaveCount(1);
    await context.close();
  });
});
