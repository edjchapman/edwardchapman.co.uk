# Deployment

How the site reaches production, on purpose and reproducibly. The pipeline is
entirely visible in [.github/workflows/](../.github/workflows/) — no
dashboard-only behaviour.

## Environments

| Surface     | What                                                                                                 | When                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Production  | Worker `edwardchapman` (workers.dev during Phase 0; `edwardchapman.co.uk` after the Phase 1 cutover) | Every push to `main` (i.e. every squash-merge), gated by the GitHub `production` environment |
| PR previews | Versioned preview uploads with alias `pr-<n>`                                                        | Every PR update                                                                              |

Preview uploads use `wrangler versions upload`, which **cannot** touch
triggers or custom domains — a preview can never affect production routing.

## Secrets

Credentials live in three independent stores; none are in source control. The
Anthropic API key sits in two of them (different consumers), so rotating it
means updating **both** — see [Rotating the Anthropic API
key](#rotating-the-anthropic-api-key).

### GitHub Actions

| Secret                  | Scope                                                         | Consumer                                          |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Minimal-scope API token (see below)                           | `deploy.yml`                                      |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not secret-sensitive, stored as one for tidiness) | `deploy.yml`                                      |
| `ANTHROPIC_API_KEY`     | `production` **environment** secret                           | `eval-live.yml` (live agent evaluation, ADR-0008) |

Cloudflare token recipe (create at dash.cloudflare.com → My Profile → API
Tokens):

- Account → **Workers Scripts : Edit**
- Zone (edwardchapman.co.uk) → **Workers Routes : Edit**, **DNS : Edit**,
  **Dynamic URL Redirects : Edit**, **Email Routing Rules : Edit**,
  **Zone Settings : Edit**

The zone-scoped permissions exist for the Phase 1 cutover (custom domain,
stale-record removal, www redirect, email routing); Workers Scripts is what
day-to-day deploys use.

### Cloudflare Worker (runtime)

`ANTHROPIC_API_KEY` — a Worker secret the deployed Worker reads at request time
as `env.ANTHROPIC_API_KEY` to answer `/api/ask` (Phase 4). Stored on the
Worker, never in the repo. This is a **separate** store from the GitHub secret
of the same name.

### Local (optional)

`ANTHROPIC_API_KEY_EDWARDCHAPMAN` — a shell environment variable used only to
run `make eval-agent-live` locally. Not needed for CI, deploys, or production.
Local development of everything else needs no secrets.

## Rotating the Anthropic API key

The key is consumed in three independent places. They fix different things, so
a full rotation updates all three:

| Where                             | Fixes                        | Command                                                                                                                     |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions (`production` env) | the live-eval workflow       | `gh secret set ANTHROPIC_API_KEY --env production`                                                                          |
| Cloudflare Worker                 | production `/api/ask`        | `wrangler versions secret put ANTHROPIC_API_KEY --name edwardchapman`, then `wrangler versions deploy --name edwardchapman` |
| Local shell (optional)            | local `make eval-agent-live` | update `ANTHROPIC_API_KEY_EDWARDCHAPMAN` wherever you export it (profile / `.env` / secrets manager)                        |

**Reading the commands: every token shown is literal — type it exactly.**
`ANTHROPIC_API_KEY` is the secret's _name_ (not its value), `edwardchapman` is
the Worker's name, `production` is the GitHub environment name. **The new key
value never appears on the command line** — `gh` and `wrangler` prompt for it
(`Paste your secret:` / `Enter a secret value:`), which keeps it out of shell
history.

**Cloudflare versioned-deploy trap.** This Worker deploys as versions, so the
plain `wrangler secret put` fails with _"the latest version of your Worker
isn't currently deployed."_ Use `wrangler versions secret put` — it stores the
secret in a new version built from the **currently deployed code** (not your
local working tree), then `wrangler versions deploy` promotes it to traffic.
Secrets persist across versions, so the next CI deploy inherits it
automatically: set each secret once.

**Verify the rotation:**

- Production Worker: `curl https://edwardchapman.co.uk/api/ask -H 'content-type: application/json' -d '{"question":"How did Foreman handle reliable event processing?"}'` returns an answer, not `upstream_error`.
- GitHub Actions: dispatch `eval-live.yml` (Actions → live agent evaluation →
  Run workflow, or `gh workflow run eval-live.yml`) and confirm it runs the
  evaluation rather than logging _"ANTHROPIC_API_KEY is not configured"_.

## Deploy flow

1. PR merges to `main` → `deploy.yml` runs in the `production` environment.
2. The workflow reproves the gate (`make check`, which includes the build),
   then runs `wrangler deploy --config dist/server/wrangler.json` (the
   adapter-emitted config — see [docs/architecture.md](architecture.md)).
3. The deployment URL and sha land in the workflow summary.
4. Verification: `curl https://<host>/api/health` returns the deployed sha.

## Monitoring the ask endpoint

`/api/ask`'s live model path depends on the Worker `ANTHROPIC_API_KEY`, an
external credential that can rot between deploys (rotation, revocation, expiry).
Two checks guard it, both keyed on the same invariant — a **grounded** answer,
i.e. HTTP 200 with a non-empty `sources` array (the invariant
`tests/e2e/ask.spec.ts` asserts). A refusal (`"sources":[]`) or an
`upstream_error` 502 fails both:

- **Post-deploy smoke** (`deploy.yml`) — gates every production deploy on a real
  `/api/ask` POST returning a grounded answer. It asserts non-empty `sources`,
  not merely an `"answer"` field, because a refusal is also `200 {"answer":…}` —
  grepping `"answer"` would pass a dead key.
- **Synthetic monitor** (`uptime-ask.yml`) — runs the same probe on a 6-hourly
  cron (plus `workflow_dispatch`) to catch credential rot **between** deploys,
  which the deploy-time smoke cannot. It hits only the public endpoint, so it
  needs no secrets; a red run is the alert. Dispatch it manually after rotating
  the key to confirm production recovered.

## Rollback

Application-level, in order of preference:

1. `pnpm exec wrangler rollback` — reverts the Worker (and its assets) to the
   previous version.
2. Re-run `deploy.yml` from the last good commit on `main` (Actions → deploy
   → Re-run), or `git revert` the offending merge and let CI deploy.

Confirm with `/api/health` — the `version` field names the serving commit.

## Domain cutover (Phase 1) — executed 2026-07-11

Prior state: the zone (already on Cloudflare nameservers) proxied the apex to
a dead Gandi origin (`A 217.70.184.38`) and `www` to Gandi's defunct redirect
service (`CNAME webredir.vip.gandi.net`) — both returned **HTTP 521**. A full
pre-cutover DNS snapshot is recorded below; a Gandi mail stack (MX/SPF/SRV)
was found on the zone and deliberately left untouched pending a decision on
the public contact address routing.

Steps executed (Cloudflare API, token scopes: Workers Scripts/Routes, DNS,
Zone Settings):

1. Deleted the two dead records (apex `A`, `www CNAME`).
2. Created a proxied placeholder `AAAA www → 100::` so the `www` route is
   proxiable.
3. Deployed `workers/www-redirect` (this repo) on the
   `www.edwardchapman.co.uk/*` route — a 301 to the apex preserving path and
   query. A zone Single-Redirect rule was the plan, but the deploy token
   deliberately lacks ruleset scopes; the worker keeps the redirect versioned
   here instead.
4. Confirmed the zone's **Always Use HTTPS** setting was already on.
5. This PR set `routes: [{pattern: "edwardchapman.co.uk", custom_domain: true}]`
   and `workers_dev: false`; the merge deploy attached the custom domain
   (DNS + edge certificate created automatically by Cloudflare).
6. Verification: apex `200`; `www/<path>?<q>` → `301` to the apex with path
   and query intact; `/api/health` reports the deployed sha;
   `sitemap-index.xml`/`robots.txt` served; workers.dev no longer serves
   production.

Rollback remains application-level (`wrangler rollback`); restoring the
deleted DNS records would only restore the 521.

<details>
<summary>Pre-cutover DNS snapshot (2026-07-11)</summary>

```text
A     edwardchapman.co.uk        → 217.70.184.38 (proxied)        [DELETED]
CNAME www                        → webredir.vip.gandi.net (proxied) [DELETED]
AAAA  www                        → 100:: (proxied)                 [CREATED]
CNAME career-portfolio           → career-portfolio-2bi.pages.dev (untouched)
CNAME mind                       → mind-9tc.pages.dev (untouched)
CNAME webmail                    → webmail.gandi.net (untouched)
MX    @                          → spool.mail.gandi.net, fb.mail.gandi.net (untouched)
SRV   _imap/_imaps/_pop3/_pop3s/_submission (untouched)
TXT   @ (SPF gandi), _dmarc      (untouched)
```

</details>

### www-redirect worker

`workers/www-redirect/` is deployed manually (it changes ~never):

```sh
make deploy-www-redirect
```

## Diagnosing failures

- **Deploy step fails** — check the Actions log; wrangler errors name the
  config path. Token expiry/permissions are the usual suspects
  (`wrangler whoami` locally with the same token).
- **Site serves but `/api/health` 404s** — the Worker didn't deploy alongside
  assets; confirm `dist/server/wrangler.json` was used (not the repo config).
- **Wrong content serving** — compare `/api/health` sha to `main`; if stale,
  the deploy didn't run or rolled back.
- **`/api/ask` returns `upstream_error` (502)** — the Worker reached Anthropic
  but the call failed; the usual cause is a missing/rotated `ANTHROPIC_API_KEY`
  (a rejected key → 401 → `provider_error`). Confirm with
  `wrangler tail --name edwardchapman` (look for `ask.provider_error`,
  `detail: "status 401 …"`) and re-key via [Rotating the Anthropic API
  key](#rotating-the-anthropic-api-key). Note: questions that don't clear the
  retrieval confidence gate return a 200 refusal regardless, so probe with a
  question known to retrieve (e.g. the smoke question above).
