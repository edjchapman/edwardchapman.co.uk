import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig, sessionDrivers } from "astro/config";

import { noteLastmods } from "./src/lib/content-dates";

// Read note content dates once at config load (astro:content isn't available
// here). Notes are the only dated collection — see src/lib/content-dates.ts.
const lastmods = await noteLastmods();

export default defineConfig({
  site: "https://edwardchapman.co.uk",
  trailingSlash: "never",
  build: { format: "file" },
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    react(),
    sitemap({
      // /404 is not a destination. /ask is indexed since the Phase 4 release
      // gates passed (docs/evaluation.md).
      filter: (page) => !page.includes("/404"),
      // Stamp notes with their content date; other URLs carry no lastmod
      // (undated — a build-time stamp would falsely mark them all changed).
      serialize(item) {
        const path = new URL(item.url).pathname.replace(/\/$/, "") || "/";
        const lastmod = lastmods.get(path);
        return lastmod ? { ...item, lastmod } : item;
      },
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
