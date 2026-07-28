import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The ask interface (spec §15): one unmocked round-trip against the real
// worker endpoint, then mocked-backend cases for submission, loading,
// answer + source rendering, failure states, and the released posture.
test.describe("/ask interface", () => {
  test("real endpoint serves a pinned baseline question (no mocks)", async ({
    request,
  }) => {
    // A chip question is answered from the baseline (ADR-0027) — served before
    // the model path, so it works with no credential, exercised here inside
    // workerd.
    const response = await request.post("/api/ask", {
      data: { question: "How did Foreman handle reliable event processing?" },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      sources: { url: string }[];
      served: string;
    };
    expect(body.served).toBe("baseline");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(source.url).toMatch(/^https:\/\/edwardchapman\.co\.uk\//);
    }
  });

  test("real endpoint answers a novel question via the model path (no mocks)", async ({
    request,
  }) => {
    // Regression guard: unit tests fake `locals` and the other e2e cases fake
    // the network, so only this probe exercises the deployed handler's env
    // access, rate-limiter, and fake-adapter path inside workerd. A nonce
    // suffix misses the baseline so the model path actually runs.
    const response = await request.post("/api/ask", {
      data: {
        question: "How did Foreman handle reliable event processing? probe-e2e",
      },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      answer: string;
      citations: { start: number; end: number; sourceIndex: number }[];
      sources: { url: string }[];
      served: string;
    };
    expect(body.served).toBe("model");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.sources.length).toBeGreaterThan(0);
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
    // ADR-0027: the pre-answered-baseline check is disclosed alongside the
    // model path.
    await expect(page.getByRole("main")).toContainText(
      "checked against a short list of pre-written answers",
    );
    await expect(page.getByRole("main")).toContainText(
      "sent to Anthropic to generate an answer",
    );
    // ADR-0023: questions are recorded for abuse monitoring and the page
    // must say so; answers stay unstored.
    await expect(page.getByRole("main")).toContainText(
      "recorded in the site's operational logs",
    );
    await expect(page.getByRole("main")).toContainText(
      "answers are never stored",
    );
    // ADR-0024: the quota cookie is disclosed — the page must describe the
    // counter, and honestly (a count, not an identifier).
    await expect(page.getByRole("main")).toContainText(
      "counts how many questions",
    );
    await expect(page.getByRole("main")).toContainText(
      "no identifier and no tracking",
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

  test("renders the exhausted-quota message (ADR-0024)", async ({ page }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "quota_exceeded",
            message:
              "You've reached today's question limit for this demo — please " +
              "come back tomorrow. Everything the assistant knows is on the " +
              "published pages.",
          },
          requestId: "t",
        }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("status")).toContainText(
      "today's question limit",
    );
  });

  test("renders the offline state (503) with a pointer, not a retry (ADR-0026)", async ({
    page,
  }) => {
    // The non-retryable class: honest copy plus a route to the published
    // pages, never "try again shortly".
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "upstream_unavailable",
            message:
              "The answer service is temporarily offline — a fault on Ed's " +
              "side, flagged for attention. Everything the assistant knows " +
              "is on the published pages.",
          },
          requestId: "t",
        }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("temporarily offline");
    await expect(status).not.toContainText("try again shortly");
    await expect(
      status.getByRole("link", { name: "experience page" }),
    ).toHaveAttribute("href", "/experience");
    await expect(
      status.getByRole("link", { name: "projects" }),
    ).toHaveAttribute("href", "/projects");
  });

  test("renders the offline state from a streamed terminal too", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ kind: "upstream_unavailable" })}\n\n`,
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("temporarily offline");
    await expect(
      status.getByRole("link", { name: "experience page" }),
    ).toHaveAttribute("href", "/experience");
  });

  test("renders a streamed transient error without an offline pointer", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ kind: "upstream_error" })}\n\n`,
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("try again shortly");
    // Transient ≠ offline: no pointer paragraph.
    await expect(status).not.toContainText("The published pages cover");
  });

  test("an unknown terminal kind fails to a transient error, not a silent idle", async ({
    page,
  }) => {
    // A newer server sending a kind this cached client doesn't know must not
    // leave the form looking hung (ADR-0026).
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ kind: "future_kind" })}\n\n`,
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByRole("status")).toContainText("try again shortly");
    await expect(page.getByLabel("Your question")).toBeEnabled();
  });

  test("a stream that dies with no answer surfaces an error, not an empty card", async ({
    page,
  }) => {
    // Zero deltas, no terminal: the connection died before answering. This
    // must read as an error, not a blank "Stopped early" card (ADR-0026).
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("try again shortly");
    await expect(status).not.toContainText("Stopped early");
  });

  test("a network failure shows the didn't-complete message", async ({
    page,
  }) => {
    await page.route("**/api/ask", (route) => route.abort());

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();

    await expect(page.getByRole("status")).toContainText("didn't complete");
  });

  test("a stalled request trips the watchdog instead of hanging forever", async ({
    page,
  }) => {
    // Route never fulfils; the 60s client watchdog aborts and surfaces an
    // error rather than an indefinitely-disabled form (ADR-0026). Fake the
    // clock so the test doesn't wait a real minute.
    await page.clock.install();
    await page.route("**/api/ask", () => new Promise(() => {}));

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("status")).toContainText("Looking through");

    await page.clock.fastForward(61_000);
    await expect(page.getByRole("status")).toContainText("didn't complete");
    await expect(page.getByLabel("Your question")).toBeEnabled();
  });

  test("real quota round-trip: cookie counts to the limit, then 429", async ({
    request,
  }) => {
    // The webServer runs with ASK_QUOTA_LIMIT=2. The cookie is threaded by
    // hand: wrangler dev presents the canonical host, so the cookie carries
    // `Secure`, which Playwright's Node-side jar won't replay over local
    // http (real browsers treat loopback as trustworthy and do). A nonce
    // suffix misses the baseline (ADR-0027) so the quota-charged model path
    // runs — a baseline hit would never set the cookie.
    const question = {
      question: "How did Foreman handle reliable event processing? probe-quota",
    };
    const replay = (setCookie: string) =>
      /(ask_quota=[^;]+)/.exec(setCookie)?.[1] ?? "";

    const first = await request.post("/api/ask", { data: question });
    expect(first.status()).toBe(200);
    const firstCookie = first.headers()["set-cookie"] ?? "";
    expect(firstCookie).toContain("ask_quota=v1.");
    expect(firstCookie).toContain("HttpOnly");

    const second = await request.post("/api/ask", {
      data: question,
      headers: { cookie: replay(firstCookie) },
    });
    expect(second.status()).toBe(200);
    const secondCookie = second.headers()["set-cookie"] ?? "";

    const third = await request.post("/api/ask", {
      data: question,
      headers: { cookie: replay(secondCookie) },
    });
    expect(third.status()).toBe(429);
    const body = (await third.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.message).toContain("today's question limit");
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
    // The availability chip uses its golden's verbatim phrasing (ADR-0022).
    await expect(
      page.getByRole("button", {
        name: "Is Ed open to contract or permanent roles?",
      }),
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

  test("an unmocked chip is answered instantly from the baseline", async ({
    page,
  }) => {
    // No route mock: the real wrangler-dev endpoint serves the chip from the
    // baseline (ADR-0027), so the answer and its distinct disclosure render
    // without a model call.
    await page.goto("/ask");
    await page
      .getByRole("button", { name: "What is Ed's educational background?" })
      .click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Birkbeck");
    await expect(status).toContainText("A pre-written answer from published");
    await expect(status.locator("ol.sources")).toHaveCount(1);
  });

  test("a baseline-served response shows the pre-written disclosure", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "A canned answer.",
          citations: [],
          sources: [],
          served: "baseline",
          requestId: "t",
        }),
      });
    });

    await page.goto("/ask");
    await page.getByLabel("Your question").fill("Anything");
    await page.getByRole("button", { name: "Ask" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText("A pre-written answer from published");
    // The baseline disclosure replaces the model one, not adds to it. A
    // response with no `served` field keeps "Generated from published site
    // content" (the existing citation test covers that stale-mock case).
    await expect(status).not.toContainText("Generated from published site");
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
