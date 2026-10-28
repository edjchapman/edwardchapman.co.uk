import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  scopeFromFile,
  scopeId,
  scopedFootnotes,
} from "../../src/lib/scoped-footnotes";

describe("scoped footnote ids (ADR-0030)", () => {
  it("prefixes footnote ids with the source file's basename", () => {
    expect(scopeId("user-content-fn-foreman", "positioning")).toBe(
      "positioning-fn-foreman",
    );
    expect(scopeId("footnote-label", "how-i-work")).toBe(
      "how-i-work-footnote-label",
    );
  });

  it("leaves non-footnote ids alone", () => {
    expect(scopeId("natoora", "experience")).toBe("natoora");
  });

  it("derives the scope from the file URL", () => {
    const url = pathToFileURL("/repo/src/content/profile/how-i-work.md");
    expect(scopeFromFile(url)).toBe("how-i-work");
    expect(scopeFromFile(undefined)).toBe("doc");
  });

  it("rewrites refs and replaces the hidden h2 label with a visible p", () => {
    const plugin = scopedFootnotes({
      fileURL: pathToFileURL("/x/positioning.md"),
    });
    const set: Record<string, unknown> = {};
    const ctx = {
      setProperty: (_n: unknown, k: string, v: unknown) => (set[k] = v),
      removeNode: () => {},
    };

    plugin.element.visit(
      {
        type: "element",
        tagName: "a",
        properties: {
          id: "user-content-fnref-foreman",
          href: "#user-content-fn-foreman",
          ariaDescribedBy: ["footnote-label"],
        },
        children: [],
      },
      ctx,
    );
    expect(set).toEqual({
      id: "positioning-fnref-foreman",
      href: "#positioning-fn-foreman",
      ariaDescribedBy: ["positioning-footnote-label"],
    });

    const label = plugin.element.visit(
      {
        type: "element",
        tagName: "h2",
        properties: { id: "footnote-label" },
        children: [],
      },
      ctx,
    );
    expect(label).toMatchObject({
      tagName: "p",
      properties: { id: "positioning-footnote-label" },
    });
  });
});

describe("footnote backrefs", () => {
  it("are removed", () => {
    const plugin = scopedFootnotes({ fileURL: undefined });
    const removed: unknown[] = [];
    const node = {
      type: "element" as const,
      tagName: "a",
      properties: { href: "#user-content-fnref-a", dataFootnoteBackref: "" },
      children: [],
    };
    plugin.element.visit(node, {
      setProperty: () => {},
      removeNode: (n) => removed.push(n),
    });
    expect(removed).toEqual([node]);
  });
});
