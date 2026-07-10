import type { APIRoute } from "astro";

export const prerender = false;

// Deploy-verification probe: reports the built commit so external checks can
// confirm which version is serving (used by the cutover and rollback runbooks).
export const GET: APIRoute = () =>
  Response.json(
    {
      status: "ok",
      version: __BUILD_SHA__,
      builtAt: __BUILD_TIME__,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
