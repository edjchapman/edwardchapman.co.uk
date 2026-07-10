/**
 * Canonical-host redirect: 301s www.edwardchapman.co.uk to the apex,
 * preserving path and query. Deployed as its own tiny Worker on the
 * `www.edwardchapman.co.uk/*` route (see wrangler.jsonc alongside).
 *
 * Why a worker and not a zone redirect rule: the deploy token deliberately
 * carries Workers scopes only — and this keeps the redirect versioned in the
 * repository with everything else (docs/deployment.md).
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
