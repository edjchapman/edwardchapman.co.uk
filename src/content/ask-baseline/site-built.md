---
question: "How is this site built?"
aliases:
  - "What is this site built with?"
  - "How was this website built?"
---

This site is built with Astro and deployed on Cloudflare Workers; almost every page is static HTML, React is confined to a single interactive island, and the ask agent is grounded in published content and gated by evaluations.[[colophon#intro]] Astro renders everything to HTML at build time and types the content as data, so the framework disappears from the shipped pages.[[colophon#why-astro]] Every change ships through one deterministic gate — format, lint, types, tests, production build, content-policy scan, and link checks — then a squash-merge and deploy from CI.[[colophon#how-it-ships]]
