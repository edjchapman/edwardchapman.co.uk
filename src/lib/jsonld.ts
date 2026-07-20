/**
 * JSON-LD node builders (spec §9: structured data). Pure and framework-free
 * so they're unit-testable without rendering `.astro` — mirrors the split in
 * src/lib/schemas.ts. Every node is rendered together as one `@graph` per
 * page via JsonLd.astro, rather than one `<script>` per node: schema.org
 * nodes cross-reference each other by `@id` (e.g. an article's `author`
 * points at the one Person node rather than repeating it), and a single
 * script per page keeps DOM structure predictable for anything that expects
 * exactly one `application/ld+json` element.
 */

import { SITE } from "./site";

export type JsonLdNode = Record<string, unknown>;

const PERSON_ID = `${SITE.origin}/#person`;

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface BlogPostingInput {
  title: string;
  description: string;
  pubDate: Date;
  updatedDate?: Date | undefined;
  tags: string[];
  url: string;
  imageUrl: string;
}

export interface SoftwareSourceCodeInput {
  title: string;
  description: string;
  tech: string[];
  repo: string;
  url: string;
}

/** The site's Person entity. `knowsAbout` is only ever the union of tech
 * already publicly listed on published project pages — never invented; it is
 * deduped here so callers can pass a raw union. */
export function personNode(opts?: { knowsAbout?: string[] }): JsonLdNode {
  const knowsAbout = [...new Set(opts?.knowsAbout ?? [])];
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: SITE.name,
    alternateName: SITE.fullName,
    url: SITE.origin,
    jobTitle: "Senior Software Engineer",
    address: {
      "@type": "PostalAddress",
      addressLocality: "London",
      addressCountry: "GB",
    },
    sameAs: [SITE.github, SITE.linkedin],
    ...(knowsAbout.length > 0 && { knowsAbout }),
  };
}

/** No `potentialAction`/`SearchAction`: `/ask` is a POST endpoint behind a
 * client:only island, not a GET results page a SearchAction can target, and
 * Google retired the Sitelinks Searchbox result in 2023 regardless. */
export function webSiteNode(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": `${SITE.origin}/#website`,
    name: SITE.name,
    url: SITE.origin,
    publisher: { "@id": PERSON_ID },
  };
}

export function breadcrumbNode(items: BreadcrumbItem[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** BlogPosting (not bare Article/TechArticle — TechArticle expects fields
 * like proficiencyLevel this content doesn't have). Every field traces to
 * real frontmatter; dateModified only appears when updatedDate is set. */
export function blogPostingNode(input: BlogPostingInput): JsonLdNode {
  return {
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    datePublished: input.pubDate.toISOString(),
    ...(input.updatedDate && {
      dateModified: input.updatedDate.toISOString(),
    }),
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    image: {
      "@type": "ImageObject",
      url: input.imageUrl,
      width: 1200,
      height: 630,
    },
    ...(input.tags.length > 0 && { keywords: input.tags }),
    mainEntityOfPage: input.url,
    url: input.url,
  };
}

/** `keywords` carries `tech` — never `programmingLanguage`, since `tech`
 * mixes languages with frameworks/infra ("Django", "AWS") and labelling all
 * of it a programming language would be false. */
export function softwareSourceCodeNode(
  input: SoftwareSourceCodeInput,
): JsonLdNode {
  return {
    "@type": "SoftwareSourceCode",
    name: input.title,
    description: input.description,
    url: input.url,
    codeRepository: input.repo,
    keywords: input.tech,
    author: { "@id": PERSON_ID },
  };
}

export function graph(nodes: JsonLdNode[]): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
}
