import { describe, expect, it } from "vitest";

import {
  blogPostingNode,
  breadcrumbNode,
  graph,
  personNode,
  softwareSourceCodeNode,
  webSiteNode,
} from "../../src/lib/jsonld";
import { SITE } from "../../src/lib/site";

const PERSON_ID = `${SITE.origin}/#person`;

describe("personNode", () => {
  it("carries the site identity and references itself by @id", () => {
    const node = personNode();
    expect(node["@type"]).toBe("Person");
    expect(node["@id"]).toBe(PERSON_ID);
    expect(node["name"]).toBe(SITE.name);
    expect(node["alternateName"]).toBe(SITE.fullName);
    expect(node["sameAs"]).toEqual([SITE.github, SITE.linkedin, SITE.x]);
  });

  it("omits knowsAbout when empty and dedupes when present", () => {
    expect(personNode()["knowsAbout"]).toBeUndefined();
    expect(personNode({ knowsAbout: [] })["knowsAbout"]).toBeUndefined();
    expect(
      personNode({ knowsAbout: ["Python", "Django", "Python", "AWS"] })[
        "knowsAbout"
      ],
    ).toEqual(["Python", "Django", "AWS"]);
  });
});

describe("webSiteNode", () => {
  it("names the site and points publisher at the person @id, without a SearchAction", () => {
    const node = webSiteNode();
    expect(node["@type"]).toBe("WebSite");
    expect(node["url"]).toBe(SITE.origin);
    expect(node["publisher"]).toEqual({ "@id": PERSON_ID });
    expect(node["potentialAction"]).toBeUndefined();
  });
});

describe("breadcrumbNode", () => {
  it("numbers items from 1 and preserves order", () => {
    const node = breadcrumbNode([
      { name: "Home", url: "https://x/" },
      { name: "Notes", url: "https://x/notes" },
      { name: "A note", url: "https://x/notes/a" },
    ]);
    expect(node["@type"]).toBe("BreadcrumbList");
    const items = node["itemListElement"] as Record<string, unknown>[];
    expect(items.map((i) => i["position"])).toEqual([1, 2, 3]);
    expect(items[2]?.["item"]).toBe("https://x/notes/a");
  });
});

describe("blogPostingNode", () => {
  const base = {
    title: "A note",
    description: "About things.",
    pubDate: new Date("2026-07-10T00:00:00Z"),
    tags: ["ai-engineering", "evaluation"],
    url: "https://edwardchapman.co.uk/notes/a",
    imageUrl: "https://edwardchapman.co.uk/og/notes/a.png",
  };

  it("emits a BlogPosting whose author/publisher reference the person @id", () => {
    const node = blogPostingNode(base);
    expect(node["@type"]).toBe("BlogPosting");
    expect(node["author"]).toEqual({ "@id": PERSON_ID });
    expect(node["publisher"]).toEqual({ "@id": PERSON_ID });
    expect(node["datePublished"]).toBe("2026-07-10T00:00:00.000Z");
    expect(node["keywords"]).toEqual(["ai-engineering", "evaluation"]);
  });

  it("carries an absolute 1200x630 image object", () => {
    const image = blogPostingNode(base)["image"] as Record<string, unknown>;
    expect(image["url"]).toBe(base.imageUrl);
    expect(image["width"]).toBe(1200);
    expect(image["height"]).toBe(630);
  });

  it("includes dateModified only when updatedDate is set", () => {
    expect(blogPostingNode(base)["dateModified"]).toBeUndefined();
    const updated = blogPostingNode({
      ...base,
      updatedDate: new Date("2026-07-15T00:00:00Z"),
    });
    expect(updated["dateModified"]).toBe("2026-07-15T00:00:00.000Z");
  });

  it("omits keywords when there are no tags", () => {
    expect(blogPostingNode({ ...base, tags: [] })["keywords"]).toBeUndefined();
  });
});

describe("softwareSourceCodeNode", () => {
  it("maps tech to keywords, never programmingLanguage", () => {
    const node = softwareSourceCodeNode({
      title: "Foreman",
      description: "Jobs get lost at crash boundaries.",
      tech: ["Python", "Django", "AWS"],
      repo: "https://github.com/edjchapman/Foreman",
      url: "https://edwardchapman.co.uk/projects/foreman",
    });
    expect(node["@type"]).toBe("SoftwareSourceCode");
    expect(node["codeRepository"]).toBe(
      "https://github.com/edjchapman/Foreman",
    );
    expect(node["keywords"]).toEqual(["Python", "Django", "AWS"]);
    expect(node["programmingLanguage"]).toBeUndefined();
    expect(node["author"]).toEqual({ "@id": PERSON_ID });
  });
});

describe("graph", () => {
  it("wraps nodes with @context and @graph", () => {
    const wrapped = graph([personNode(), webSiteNode()]);
    expect(wrapped["@context"]).toBe("https://schema.org");
    const nodes = wrapped["@graph"] as Record<string, unknown>[];
    expect(nodes.map((n) => n["@type"])).toEqual(["Person", "WebSite"]);
  });
});
