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

  test("privacy copy describes the released question-processing path", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("main")).toContainText(
      "your question is sent to Anthropic",
    );
    await expect(page.getByRole("main")).toContainText(
      "does not store questions or answers in a database",
    );
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
    await expect(marker).toHaveAttribute("href", "#ask-source-0-1");
    // …and the numbered source links out to the canonical page.
    await expect(
      status.locator("#ask-source-0-1").getByRole("link", {
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
    ).toHaveAttribute("href", "#ask-source-0-1");
    await expect(
      status.locator("#ask-source-0-1").getByRole("link"),
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
    // The refusal is not a dead end: a static pointer routes technology
    // questions to the published stack-depth content.
    const pointer = status.getByRole("link", { name: "experience page" });
    await expect(pointer).toHaveAttribute("href", "/experience");
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
    // The career chip (ADR-0019 surface) must be present and clickable.
    await expect(
      page.getByRole("button", { name: "Where has Ed worked, and when?" }),
    ).toBeVisible();
    // The education chip uses its golden's verbatim phrasing.
    await expect(
      page.getByRole("button", {
        name: "What is Ed's educational background?",
      }),
    ).toBeVisible();
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
    // The client:only fallback slot renders the same-geometry skeleton, so
    // the pre-hydration page (and no-JS page) is never a blank hole.
    await expect(page.locator(".ask-fallback")).toHaveCount(1);
    await context.close();
  });

  test("a stream that ends without a terminal event finalises as stopped", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ kind: "answer_delta", text: "Partial " })}\n\n`,
          `data: ${JSON.stringify({ kind: "answer_delta", text: "answer" })}\n\n`,
        ].join(""),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Partial answer");
    await expect(status).toContainText("Stopped early");
    // The form recovers: input re-enabled, ready for the next question.
    await expect(page.getByLabel("Your question")).toBeEnabled();
  });

  test("stop before any answer arrives returns quietly to the form", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.abort();
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.getByLabel("Your question")).toBeEnabled();
    await expect(page.getByRole("status")).not.toContainText("didn't complete");
  });

  test("two questions build a transcript with distinct source anchors", async ({
    page,
  }) => {
    let call = 0;
    await page.route("**/api/ask", async (route) => {
      call += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: `Answer ${call}.`,
          citations: [{ start: 0, end: 9, sourceIndex: 0 }],
          sources: [
            {
              title: `Source ${call}`,
              url: `https://edwardchapman.co.uk/projects/foreman`,
            },
          ],
          requestId: "t",
        }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("First question?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.locator("#ask-source-0-1")).toBeVisible();

    await page.getByLabel("Your question").fill("Second question?");
    await page.getByRole("button", { name: "Ask" }).click();
    // The first exchange moves to the transcript, keeping its anchor; the
    // new answer gets the next namespace and echoes its question.
    await expect(page.locator("#ask-source-0-1")).toBeVisible();
    await expect(page.locator("#ask-source-1-1")).toBeVisible();
    const transcript = page.locator(".ask .transcript");
    await expect(transcript).toContainText("Answer 1.");
    await expect(page.getByRole("status")).toContainText("Second question?");
  });

  test("a character counter appears near the input limit", async ({ page }) => {
    await page.goto("/ask");
    const input = page.getByLabel("Your question");
    await input.fill("x".repeat(450));
    await expect(page.locator(".ask .counter")).toHaveText("450/500");
    await input.fill("short");
    await expect(page.locator(".ask .counter")).toHaveCount(0);
  });
});
