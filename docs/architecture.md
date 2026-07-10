# Architecture

<!-- Stub — expanded in Phase 0 PR-3. -->

Static-first Astro 7 site served from Cloudflare Workers Static Assets; the
Worker executes only explicit `prerender = false` routes (`/api/*`). Content is
typed data in Astro content collections. Decisions are recorded in
[docs/adr/](adr/).
