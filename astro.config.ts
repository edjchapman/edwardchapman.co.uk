import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig, sessionDrivers } from "astro/config";

export default defineConfig({
  site: "https://edwardchapman.co.uk",
  trailingSlash: "never",
  build: { format: "file" },
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    react(),
    sitemap({
      // /404 is not a destination; /ask stays unadvertised until the Phase 4
      // release gates pass (docs/evaluation.md).
      filter: (page) => !page.includes("/404") && !page.includes("/ask"),
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
