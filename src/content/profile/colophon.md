---
title: "Colophon"
order: 4
updatedDate: 2026-07-10
---

How this site is built, and why — because for an engineer's personal site,
the _how_ is part of the point. In short: the site is built with Astro and
deployed on Cloudflare Workers; almost every page is static, React is
confined to a single interactive island, and the "ask" agent is grounded in
published content and gated by evaluations. The sections below give the
reasoning.

## Why Astro

This is a content site with exactly one genuinely interactive feature on its
roadmap. Astro renders everything to HTML at build time, types the content as
data (every project card and note validates against a schema before it can
ship), and lets JavaScript exist only as deliberate islands. The framework
disappears from the shipped pages entirely.

## Why almost everything is static

Pages you can read are files on a CDN; there is nothing to crash, cold-start,
or patch. The previous incarnation of this domain died with its origin server
— Cloudflare dutifully proxying to a machine that no longer existed. This
version structurally cannot fail that way: there is no origin. Code runs only
on two API routes that declare themselves dynamic, and adding a third
requires updating a public architecture decision record first.

## Why React stays in islands

React is a fine tool for stateful interfaces and an expensive default for
prose. Until the "ask" feature ships there is no React on this site at all —
zero client-side JavaScript. When it arrives, it will hydrate one form, and
the rest of the page will remain plain HTML.

## Why Cloudflare Workers

The domain was already on Cloudflare, and Workers with Static Assets gives
both halves of the architecture one home: static pages served from the edge
without invoking code, and a small Worker for the API routes. Deploys are
wrangler from GitHub Actions — visible in the repository, reproducible, and
rollback-able in one command.

## How the "ask" agent will be grounded

An agent that answers questions about my work is being built behind release
gates. Its entire knowledge is a corpus generated at build time from the
published content on this site — nothing else. Retrieval is deterministic and
transparent (lexical scoring, not embeddings, until measurements justify
otherwise); answers must cite the passages they used, citations are validated
against what was actually retrieved, and questions the corpus can't support
get an explicit refusal rather than an improvisation.

## How it's evaluated

Two layers, split on purpose. Deterministic evaluations — retrieval ranking,
refusal routing, prompt construction, API contract, injection resistance —
run against fixtures on every pull request and block merging. Live
evaluations call the real model on a schedule and before releases, scoring
groundedness, completeness, citation correctness, and refusal quality against
recorded thresholds. The agent doesn't get linked from this site until both
pass, along with a manual red-team check.

## Privacy boundaries

No analytics, no cookies, no tracking. Private career material never enters
the repository, the build, prompts, or logs — a content-policy scanner runs
inside the same gate as the tests and fails the build on violations, so the
boundary is enforced by machinery rather than memory.

## How it ships

Every change: branch → pull request → a single deterministic gate (format,
lint, types, tests, production build, content-policy scan, built-output link
checks) → squash-merge → deploy from CI. Pull requests get preview URLs that
cannot touch production routing. `/api/health` reports the exact commit
serving you.

The [source is public](https://github.com/edjchapman/edwardchapman.co.uk) —
spec, ADRs, gates and all.
