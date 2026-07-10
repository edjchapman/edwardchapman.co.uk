# Deployment

How the site reaches production, on purpose and reproducibly. The pipeline is
entirely visible in [.github/workflows/](../.github/workflows/) — no
dashboard-only behaviour.

## Environments

| Surface | What | When |
|---|---|---|
| Production | Worker `edwardchapman` (workers.dev during Phase 0; `edwardchapman.co.uk` after the Phase 1 cutover) | Every push to `main` (i.e. every squash-merge), gated by the GitHub `production` environment |
| PR previews | Versioned preview uploads with alias `pr-<n>` | Every PR update |

Preview uploads use `wrangler versions upload`, which **cannot** touch
triggers or custom domains — a preview can never affect production routing.

## Secrets (GitHub Actions)

| Secret | Scope |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Minimal-scope API token (see below) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not secret-sensitive, stored as one for tidiness) |

Token recipe (create at dash.cloudflare.com → My Profile → API Tokens):

- Account → **Workers Scripts : Edit**
- Zone (edwardchapman.co.uk) → **Workers Routes : Edit**, **DNS : Edit**,
  **Dynamic URL Redirects : Edit**, **Email Routing Rules : Edit**,
  **Zone Settings : Edit**

The zone-scoped permissions exist for the Phase 1 cutover (custom domain,
stale-record removal, www redirect, email routing); Workers Scripts is what
day-to-day deploys use. No secrets live in source control; local development
needs none.

## Deploy flow

1. PR merges to `main` → `deploy.yml` runs in the `production` environment.
2. The workflow reproves the gate (`make check`, which includes the build),
   then runs `wrangler deploy --config dist/server/wrangler.json` (the
   adapter-emitted config — see [docs/architecture.md](architecture.md)).
3. The deployment URL and sha land in the workflow summary.
4. Verification: `curl https://<host>/api/health` returns the deployed sha.

## Rollback

Application-level, in order of preference:

1. `pnpm exec wrangler rollback` — reverts the Worker (and its assets) to the
   previous version.
2. Re-run `deploy.yml` from the last good commit on `main` (Actions → deploy
   → Re-run), or `git revert` the offending merge and let CI deploy.

Confirm with `/api/health` — the `version` field names the serving commit.

## Domain cutover (Phase 1)

The full runbook (stale-record removal, Worker custom domain, www→apex 301,
Email Routing for the public contact address, verification matrix) lands here
with the Phase 1 cutover PR. Current state: apex/www still point at the dead
origin (521) pending cutover; Phase 0 serves from workers.dev.

## Diagnosing failures

- **Deploy step fails** — check the Actions log; wrangler errors name the
  config path. Token expiry/permissions are the usual suspects
  (`wrangler whoami` locally with the same token).
- **Site serves but `/api/health` 404s** — the Worker didn't deploy alongside
  assets; confirm `dist/server/wrangler.json` was used (not the repo config).
- **Wrong content serving** — compare `/api/health` sha to `main`; if stale,
  the deploy didn't run or rolled back.
