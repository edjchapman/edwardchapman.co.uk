/**
 * Canonical-host redirect: 301s every non-canonical hostname — www on the
 * canonical zone, plus the edchapman.co.uk alias domain (apex and www) — to
 * https://edwardchapman.co.uk, preserving path and query. Deployed as its
 * own tiny Worker on the routes in wrangler.jsonc alongside.
 *
 * Why a worker and not zone redirect rules: the redirect stays versioned in
 * the repository with everything else (docs/deployment.md).
 */

export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(
      `https://edwardchapman.co.uk${url.pathname}${url.search}`,
      301,
    );
  },
};
