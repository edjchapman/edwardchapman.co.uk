import { defineConfig, devices } from "@playwright/test";

// E2E runs against the *built* site served by wrangler dev — real Workers
// Static Assets semantics (html_handling redirects, 404-page handling, the
// /api worker route), not the Astro dev server.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8788",
    // Cross-document view transitions (ADR-0020) never settle in headless
    // Chromium, hanging Playwright's actionability checks after the first
    // navigation. Reduce-motion disables them via the site's own media
    // query — the suite exercises exactly what a reduce-preference visitor
    // gets; the transition itself is verified manually per the ADR.
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: {
    command:
      "pnpm run build && pnpm exec wrangler dev --config dist/server/wrangler.json --var ASK_MODEL_MODE:fake --port 8788",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
