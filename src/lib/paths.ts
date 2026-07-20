/**
 * Normalise a build-time pathname to its served route. With
 * `build.format: "file"` Astro's prerender-time `Astro.url.pathname` is the
 * emitted file name (`/colophon.html`, `/index.html`, `/projects/foreman.html`)
 * rather than the route; canonical URLs and nav-state comparisons need the
 * served form (slash-free except the root).
 */
export function normalizePath(pathname: string): string {
  let path = pathname;
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"index.html".length);
  } else if (path.endsWith(".html")) {
    path = path.slice(0, -".html".length);
  }
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Resolve the canonical URL for a page: an explicit override (e.g. a note
 * that syndicates an external original) wins; otherwise it derives from the
 * served pathname on the given origin. Kept separate from `og:url`, which
 * should always describe this page's own address even when the canonical
 * points elsewhere.
 */
export function resolveCanonical(
  override: string | undefined,
  pathname: string,
  origin: string,
): string {
  return override ?? new URL(normalizePath(pathname), origin).href;
}
