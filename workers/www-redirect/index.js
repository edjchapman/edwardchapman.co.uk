/**
 * Canonical-host redirect: 301s every non-canonical hostname — www on the
 * canonical zone, plus the edchapman.co.uk alias domain (apex and www) — to
 * https://edwardchapman.co.uk, preserving path and query. Deployed as its
 * own tiny Worker on the routes in wrangler.jsonc alongside.
 *
 * Why a worker and not zone redirect rules: the redirect stays versioned in
 * the repository with everything else (docs/deployment.md).
 *
 * The retired "EC Docs" site that previously lived on www still has pages in
 * search indexes. Those paths have no successor here, so they answer 410 Gone
 * instead of redirecting into the apex's 404 — a 410 tells crawlers to drop
 * the URL, where a 301-into-404 reads as a broken redirect and lingers.
 * Scoped to the www host (the alias domain never served the docs site);
 * revisit the prefix list if the site ever adds a page under one of them.
 */

const RETIRED_DOCS_HOST = "www.edwardchapman.co.uk";
const RETIRED_DOCS_PREFIXES = ["/code_quality", "/security", "/system_admin"];

export default {
  fetch(request) {
    const url = new URL(request.url);
    const retired =
      url.hostname === RETIRED_DOCS_HOST &&
      RETIRED_DOCS_PREFIXES.some(
        (prefix) =>
          url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      );
    if (retired) {
      return new Response(
        "Gone. This page belonged to a retired site; the current one is https://edwardchapman.co.uk/\n",
        {
          status: 410,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=86400",
          },
        },
      );
    }
    return Response.redirect(
      `https://edwardchapman.co.uk${url.pathname}${url.search}`,
      301,
    );
  },
};
