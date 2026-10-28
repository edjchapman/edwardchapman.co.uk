/**
 * Sätteri hast plugin for GFM footnotes as citations (ADR-0030).
 *
 * - **Scoped ids.** Footnote ids are fixed (`footnote-label`,
 *   `user-content-fn-<label>`), so two Markdown entries rendered on one page
 *   — the homepage renders several profile entries — collide. Each id, in-page
 *   href and aria-describedby is prefixed with the source file's basename.
 * - **A visible "Sources" label.** The default is a visually hidden `<h2>`,
 *   which breaks heading order inside a section; it becomes a `<p>`.
 * - **No backrefs.** Sources sit beside (desktop) or directly after (mobile)
 *   the claims they support, so "↩" links add little — and at glyph size
 *   they fail WCAG 2.2's 24px target-size rule.
 */

import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const FOOTNOTE_ID = /^(?:user-content-|footnote-label$)/;

export function scopeId(value: string, scope: string): string {
  return FOOTNOTE_ID.test(value)
    ? `${scope}-${value.replace(/^user-content-/, "")}`
    : value;
}

export function scopeFromFile(fileURL: URL | undefined): string {
  if (!fileURL) return "doc";
  return basename(fileURLToPath(fileURL)).replace(/\.[^.]+$/, "") || "doc";
}

interface Element {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: unknown[];
}

interface VisitorContext {
  setProperty(node: Readonly<Element>, key: string, value: unknown): void;
  removeNode(node: Readonly<Element>): void;
}

export function scopedFootnotes(ctx: { readonly fileURL: URL | undefined }) {
  const scope = scopeFromFile(ctx.fileURL);
  return {
    name: "scoped-footnotes",
    element: {
      filter: ["a", "h2", "li", "sup"],
      visit(node: Readonly<Element>, v: VisitorContext): Element | void {
        const props = node.properties ?? {};
        if ("dataFootnoteBackref" in props) {
          v.removeNode(node);
          return;
        }
        const id = props["id"];

        if (node.tagName === "h2" && id === "footnote-label") {
          return {
            type: "element",
            tagName: "p",
            properties: {
              id: scopeId(id, scope),
              className: ["footnotes-label"],
            },
            children: [{ type: "text", value: "Sources" }],
          };
        }

        if (typeof id === "string")
          v.setProperty(node, "id", scopeId(id, scope));
        const href = props["href"];
        if (typeof href === "string" && href.startsWith("#")) {
          v.setProperty(node, "href", `#${scopeId(href.slice(1), scope)}`);
        }
        const describedBy = props["ariaDescribedBy"];
        if (Array.isArray(describedBy)) {
          v.setProperty(
            node,
            "ariaDescribedBy",
            describedBy.map((d: unknown) =>
              typeof d === "string" ? scopeId(d, scope) : d,
            ),
          );
        }
      },
    },
  };
}
