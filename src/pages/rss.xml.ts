import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

import { SITE } from "../lib/site";

// Prerendered: the feed is a static asset regenerated on every build.
export const prerender = true;

export const GET: APIRoute = async (context) => {
  const notes = await getCollection("notes", ({ data }) => !data.draft);
  const newestFirst = [...notes].sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  return rss({
    title: `${SITE.name} — Notes`,
    description:
      "Technical notes on backend reliability, evaluation-driven AI engineering, and building for the web platform.",
    site: context.site ?? SITE.origin,
    trailingSlash: false,
    items: newestFirst.map((note) => ({
      title: note.data.title,
      description: note.data.description,
      pubDate: note.data.pubDate,
      link: `/notes/${note.id}`,
    })),
  });
};
