# ADR-0017: Structured data via a single JSON-LD `@graph`

**Status:** Accepted (2026-07-20)

## Context

Spec §9 mandates JSON-LD structured data — Person on the homepage, Article on
notes — and Phase 2 (§18) lists "Improved structured data" as a deliverable.
The shipped implementation was minimal and did not yet meet that Phase-2 bar:
a Person block on the homepage only (`JsonLdPerson.astro`), a bare `Article`
object inlined in the note route, **no** structured data on project pages, no
`WebSite` node, and no breadcrumbs. Each page emitted at most one
`application/ld+json` script, and two e2e tests asserted exactly one such
element per page.

This ADR records the enrichment and the shape decisions behind it. Everything
is build-time (ADR-0003) and every field traces to content already public on
the page it describes (ADR-0007/0011) — no field is invented.

## Decision

- **One `@graph` script per page, nodes cross-referenced by `@id`.** Each page
  emits a single `<script type="application/ld+json">` containing
  `{"@context": "https://schema.org", "@graph": [...]}`. Nodes reference each
  other by `@id` — an article's `author`/`publisher` and the `WebSite`'s
  `publisher` all point at one `#person` node — rather than repeating the
  Person inline. Builders live in a pure, unit-tested `src/lib/jsonld.ts`
  (mirroring `src/lib/schemas.ts`); a thin `JsonLd.astro` renders the graph
  and escapes `<` so a title containing `</script>` cannot break out.
- **The Person is defined on every page, not only referenced.** Note and
  project pages include the full `personNode()` in their own `@graph`
  alongside the content node, sharing the `#person` `@id`. Google resolves
  `@id` references within a single page, and its Article guidance requires
  `author.name`; a bare `{"@id": …}` whose named node lived only on the
  homepage would leave the author unnamed on the article page itself.
  Same-`@id` nodes across pages are merged, not duplicated, by consumers — the
  homepage node additionally carries `knowsAbout`.
- **`Article` → `BlogPosting`** for notes: a dated writing stream is a
  `BlogPosting` (a subtype of `Article`); `TechArticle` expects fields such as
  `proficiencyLevel`/`dependencies` this content does not have. The node adds
  `image` (the per-note 1200×630 OG card), `keywords` (tags), `publisher`,
  `mainEntityOfPage`, and `dateModified` (only when `updatedDate` is set).
- **`SoftwareSourceCode` on project pages**, which previously had none. `tech`
  maps to `keywords`, **never `programmingLanguage`** — `tech` mixes languages
  with frameworks and infrastructure ("Django", "AWS"), so calling all of it a
  programming language would be false.
- **`BreadcrumbList` on nested pages**, plus a visible `Breadcrumbs.astro`
  trail driven by the _same_ items array, so the rendered trail and the
  structured data cannot drift. Index pages are one hop from the homepage and
  get neither.
- **`knowsAbout` on the homepage Person** is the deduped union of `tech` across
  **all** published projects (not just featured), each entry already public on
  its project page.
- **`alternateName: "Edward Chapman"`** (recorded as `SITE.fullName`) lets
  search engines reconcile the displayed "Ed Chapman" with the formal name in
  the domain as one entity; `name` stays "Ed Chapman" to match the visible
  site everywhere.

## Alternatives rejected

- **A `SearchAction` / `potentialAction` on the `WebSite`.** `/ask` is a POST
  endpoint behind a `client:only` island, not a GET results page a
  `SearchAction` `urlTemplate` can target, and Google retired the Sitelinks
  Searchbox rich result in 2023. Pointing a "site search" action at an AI Q&A
  endpoint would misrepresent the surface for no benefit. Omitted.
- **Tag hub pages** (`/notes/tags/[tag]`). With 6 published notes across 9 tags
  — 5 of them matching a single note — dedicated tag pages would be thin,
  near-duplicate content that dilutes rather than concentrates ranking signals,
  the opposite of the topic-cluster goal. The internal-linking benefit is
  instead delivered by a "related notes" block (notes sharing a tag) on each
  note, with no new indexable route. Revisit once the median tag covers ≥ 3
  notes (roughly ≥ 15–20 published notes). This mirrors ADR-0006's
  "not yet, and here's the trigger" stance.
- **One `<script>` per node.** Simpler to append, but multiplies script tags,
  loses `@id` cross-referencing, and would still have forced the same e2e-test
  changes. The single-graph form is the schema.org-idiomatic shape.

## Consequences

- The two e2e tests that assumed exactly one `ld+json` element now parse the
  `@graph` array; this was a required, one-time change, contained to their
  parse logic (not their selector) by keeping one script per page.
- `JsonLdPerson.astro` is removed, folded into `personNode()`.
- Any new page type gets structured data by composing `jsonld.ts` builders and
  rendering `<JsonLd>`; new fields must keep tracing to public content
  (ADR-0007/0011), enforced by the content-policy scan over built output.
- Rich-result validity is not gated in CI; validate changed pages manually via
  Google's Rich Results Test / the schema.org validator when structured data
  changes (noted in the PR checklist rather than automated, consistent with
  ADR-0010 keeping the deterministic gate at `make check`).
