import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import { defineConfig, sessionDrivers } from "astro/config";

export default defineConfig({
  site: "https://edwardchapman.co.uk",
  trailingSlash: "never",
  build: { format: "file" },
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404"),
    }),
  ],
  // Sessions are unused on this site. Without an explicit driver the adapter
  // auto-provisions a Cloudflare KV namespace (spec: no KV — see docs/spec.md
  // "Simplicity before infrastructure").
  session: { driver: sessionDrivers.null() },
  vite: {
    define: {
      __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? "dev"),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  },
});
