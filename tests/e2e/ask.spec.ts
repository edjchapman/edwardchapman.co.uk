import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The ask interface (spec §15): one unmocked round-trip against the real
// worker endpoint, then mocked-backend cases for submission, loading,
// answer + source rendering, failure states, and the released posture.
test.describe("/ask interface", () => {
  test("real endpoint answers a corpus question (no mocks)", async ({
    request,
  }) => {
    // Regression guard: unit tests fake `locals` and the other e2e cases fake
    // the network, so only this probe exercises the deployed handler's env
    // access and rate-limiter path inside workerd.
    const response = await request.post("/api/ask", {
      data: { question: "How did Foreman handle reliable event processing?" },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      citations: { start: number; end: number; sourceIndex: number }[];
      sources: { url: string }[];
      requestId: string;
    };
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
    }
    // The fake adapter path exercises API-enforced citations end-to-end
    // inside workerd (ADR-0012): spans must satisfy the contract invariants.
    expect(body.citations.length).toBeGreaterThan(0);
    for (const citation of body.citations) {
      expect(citation.start).toBeGreaterThanOrEqual(0);
      expect(citation.start).toBeLessThan(citation.end);
      expect(citation.end).toBeLessThanOrEqual(body.answer.length);
      expect(citation.sourceIndex).toBeGreaterThanOrEqual(0);
      expect(citation.sourceIndex).toBeLessThan(body.sources.length);
    }
  });

  test("is released: linked in the nav, indexable, in the sitemap", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Site" }).getByRole("link", {
        name: "Ask",
      }),
    ).toHaveCount(1);

    await page.goto("/ask");
    // SEO.astro emits "noindex, nofollow" when explicitly noindexed, else a
    // permissive directive; released => the permissive one, never noindex.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "max-image-preview:large, max-snippet:-1",
    );

    const sitemap = await request.get("/sitemap-0.xml");
    expect(await sitemap.text()).toContain("/ask");
  });

  test("submits a question and renders the answer with inline citations", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "Foreman uses a transactional outbox.",
          citations: [{ start: 0, end: 36, sourceIndex: 0 }],
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
    // Inline marker anchors to the numbered source entry (ADR-0012)…
    const marker = status.getByRole("link", {
      name: "Source 1: Foreman — Architecture",
    });
    await expect(marker).toHaveAttribute("href", "#ask-source-1");
    // …and the numbered source links out to the canonical page.
    await expect(
      status.locator("#ask-source-1").getByRole("link", {
        name: "Foreman — Architecture",
      }),
    ).toHaveAttribute("href", "https://edwardchapman.co.uk/projects/foreman");
    await expect(status).toContainText("Generated from published site content");
  });

  test("streams an SSE answer and finalises inline citations (ADR-0016)", async ({
    page,
  }) => {
    const events = [
      { kind: "answer_delta", text: "Foreman uses " },
      { kind: "answer_delta", text: "a transactional outbox." },
      {
        kind: "answered",
        citations: [{ start: 0, end: 36, sourceIndex: 0 }],
        sources: [
          {
            title: "Foreman — Architecture",
            url: "https://edwardchapman.co.uk/projects/foreman",
          },
        ],
      },
    ];
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("How does Foreman work?");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    // The reassembled deltas render as the full answer…
    await expect(status).toContainText("Foreman uses a transactional outbox.");
    // …and the terminal event finalises the inline marker + numbered source.
    await expect(
      status.getByRole("link", { name: "Source 1: Foreman — Architecture" }),
    ).toHaveAttribute("href", "#ask-source-1");
    await expect(
      status.locator("#ask-source-1").getByRole("link"),
    ).toHaveAttribute("href", "https://edwardchapman.co.uk/projects/foreman");
  });

  test("renders a streamed refusal with no sources", async ({ page }) => {
    const refusal =
      "I could not find enough published information on this site to answer that reliably.";
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ kind: "refused", answer: refusal, reason: "low_confidence" })}\n\n`,
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("What is the weather?");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("could not find enough published");
    await expect(status.locator("ol.sources")).toHaveCount(0);
  });

  test("shows the loading state while a request is in flight", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "Done.",
          citations: [],
          sources: [],
          requestId: "t",
        }),
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
        body: JSON.stringify({
          answer: "Ok.",
          citations: [],
          sources: [],
          requestId: "t",
        }),
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
