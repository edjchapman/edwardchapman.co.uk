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
