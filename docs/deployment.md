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

Credentials live in independent stores; none are in source control. The
Anthropic API key has **two authoritative copies** (different consumers on
different platforms) plus an optional local one — `make rotate-anthropic-key`
updates them in one command (ADR-0014); see [Rotating the Anthropic API
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
- Zones (edwardchapman.co.uk **and** edchapman.co.uk) → **Workers Routes :
  Edit**, **DNS : Edit**, **Dynamic URL Redirects : Edit**, **Email Routing
  Rules : Edit**, **Zone Settings : Edit**

The zone-scoped permissions exist for the domain cutovers (custom domain,
stale-record removal, redirects, email routing — see the cutover sections
below); Workers Scripts is what day-to-day deploys use.

### Cloudflare Worker (runtime)

`ANTHROPIC_API_KEY` — a Worker secret the deployed Worker reads at request time
as `env.ANTHROPIC_API_KEY` to answer `/api/ask` (Phase 4). Stored on the
Worker, never in the repo. This is a **separate** store from the GitHub secret
of the same name. The canonical endpoint fails closed with `upstream_unavailable`
(the non-retryable class, 503, ADR-0026) when it is absent; it never falls back
to the fake adapter (ADR-0018).

`ASK_QUOTA_SECRET` — a Worker secret that signs the per-visitor quota cookie
(ADR-0024). Set it with the same versioned two-step as the Anthropic key
(see [the versioned-deploy trap](#rotating-the-anthropic-api-key)); a
generated value works well:

```sh
openssl rand -base64 32 |
  pnpm exec wrangler versions secret put ASK_QUOTA_SECRET --name edwardchapman
pnpm exec wrangler versions deploy --name edwardchapman
```

When it is absent the quota layer is skipped (logged as `ask.quota_skipped`)
and `scripts/probe-live-security.ts` fails its cookie probe after the next
deploy — production cannot silently run without the quota. Rotation is
harmless: it resets every visitor's 24-hour window and nothing else.

`ANTHROPIC_BASE_URL` + `ASK_AI_GATEWAY_TOKEN` — the optional Cloudflare AI
Gateway routing (ADR-0025). Both **unset** ⇒ the Worker calls the Anthropic API
directly (the default). Set **both** to route through the authenticated gateway:

```sh
printf 'https://gateway.ai.cloudflare.com/v1/<account_id>/edwardchapman-ask/anthropic' |
  pnpm exec wrangler versions secret put ANTHROPIC_BASE_URL --name edwardchapman
pnpm exec wrangler versions secret put ASK_AI_GATEWAY_TOKEN --name edwardchapman  # paste the gateway token
pnpm exec wrangler versions deploy --name edwardchapman
```

They are Worker secrets (not committed vars), so turning the gateway on or off
is a runtime op with no code change and no redeploy risk — remove both to revert
to the direct API. `ANTHROPIC_BASE_URL` set **without** the token sends
unauthenticated requests the gateway rejects; set the pair together. Dashboard
setup (create the gateway, its 100 req/hr rate limit, and the auth token, plus
the Anthropic Console spend limit) is in ADR-0025.

### Local (optional)

`ANTHROPIC_API_KEY_EDWARDCHAPMAN` — a shell environment variable used only to
run `make eval-agent-live` locally. Not needed for CI, deploys, or production.
Local development of everything else needs no secrets. It is **not** an
authoritative store (ADR-0014): live evaluation runs in CI by default, so this
copy may simply not exist.

`scripts/run-agent-evals.ts` reads the **unsuffixed** `ANTHROPIC_API_KEY`; the
`eval-agent-live` target bridges the two names, so exporting either works. The
suffix keeps the project key from colliding with a global `ANTHROPIC_API_KEY`
that other tooling picks up.

Give it a durable home rather than a bare `export` — an ad-hoc
`launchctl setenv` does not survive a reboot and goes stale silently at the
next rotation, invisible to every shell profile. On macOS, the Keychain:

```sh
# Store once (-w last ⇒ hidden prompt, value never on argv or in history):
security add-generic-password -U -a "$USER" -s edwardchapman-anthropic -w

# Read on demand, in ~/.zshrc:
export ANTHROPIC_API_KEY_EDWARDCHAPMAN=$(
  security find-generic-password -w -s edwardchapman-anthropic 2>/dev/null
)
```

A stale value fails confusingly (HTTP 401 mid-evaluation) rather than cleanly.
To check one without spending tokens, authenticate against a request that
generates none:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY_EDWARDCHAPMAN" -H 'anthropic-version: 2023-06-01'
# 200 = live, 401 = revoked
```

Local `/api/ask` requests use the deterministic fake adapter even if a
developer has a key configured. The local preview and Playwright commands pass
`ASK_MODEL_MODE=fake` to `wrangler dev`; the deploy configuration never defines
that binding. Successful builds strip the Cloudflare adapter's generated
`.dev.vars` from `dist/`, so previews and browser tests do not inherit local
provider credentials. Live calls remain explicit through the evaluation
command or protected workflow (ADR-0018).

## Rotating the Anthropic API key

**Use `make rotate-anthropic-key`** (ADR-0014). It reads the new value once from
a hidden prompt and updates both authoritative stores in the right order —
Cloudflare Worker (the versioned two-step below, automated end to end) then the
GitHub `production` env — and finishes by verifying the live endpoint returns a
grounded answer. Requires local `wrangler` (Cloudflare auth) and `gh` (GitHub
auth); it does not touch the optional local `ANTHROPIC_API_KEY_EDWARDCHAPMAN`.

The rest of this section documents what the command does, for when it can't be
used (no local auth) or a store must be updated by hand. The key is consumed in
three independent places, which fix different things:

| Where                             | Fixes                        | Command                                                                                                                     |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Worker                 | production `/api/ask`        | `wrangler versions secret put ANTHROPIC_API_KEY --name edwardchapman`, then `wrangler versions deploy --name edwardchapman` |
| GitHub Actions (`production` env) | the live-eval workflow       | `gh secret set ANTHROPIC_API_KEY --env production`                                                                          |
| Local shell (optional)            | local `make eval-agent-live` | `security add-generic-password -U -a "$USER" -s edwardchapman-anthropic -w` (see [Local](#local-optional))                  |

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

**Revoke the old key.** Rotation is not finished until the previous key is
deleted in the Anthropic Console (Settings → API keys). Until then both keys
spend against the same wallet, so a leak of the old one — usually the reason
for rotating — is still live, and every check below stays ambiguous.

**Verify the rotation:**

- Production Worker: `curl https://edwardchapman.co.uk/api/ask -H 'content-type: application/json' -d '{"question":"How did Foreman handle reliable event processing?"}'` returns an answer, not `upstream_error`. This proves the **new** key is serving only once the old one is revoked — before that, a rotation that silently failed to promote passes identically.
- Worker version audit: `pnpm exec wrangler versions list --name edwardchapman`
  — the newest version should be messaged _Updated secret "ANTHROPIC_API_KEY"_,
  and `pnpm exec wrangler versions secret list --name edwardchapman` should show
  that same version at **(100%)**. This is what catches the skipped-promote
  trap directly, rather than inferring it from endpoint behaviour.
- GitHub Actions: dispatch `eval-live.yml` (Actions → live agent evaluation →
  Run workflow, or `gh workflow run eval-live.yml`) and confirm it runs the
  evaluation rather than logging _"ANTHROPIC_API_KEY is not configured"_. To
  confirm the copy without spending a live evaluation, re-set it from the same
  value you verified: `gh secret set ANTHROPIC_API_KEY --env production`.
  `gh secret list --env production` shows names and timestamps, never values.

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
upstream failure (`upstream_error` 502 or `upstream_unavailable` 503, ADR-0026)
fails both:

- **Post-deploy smoke** (`deploy.yml`) — gates every production deploy on a real
  `/api/ask` POST returning a grounded answer. It asserts non-empty `sources`,
  not merely an `"answer"` field, because a refusal is also `200 {"answer":…}` —
  grepping `"answer"` would pass a dead key.
- **Synthetic monitor** (`uptime-ask.yml`) — runs the same probe on an hourly
  cron (plus `workflow_dispatch`) to catch credential rot **between** deploys,
  which the deploy-time smoke cannot. It hits only the public endpoint, so it
  needs no external secrets (one Haiku call per healthy run — ~24/day,
  negligible; failed runs cost nothing). Dispatch it manually after rotating
  the key or topping up credit to confirm production recovered.

**Alerting.** A red workflow run is not a reliable signal on its own — a red
post-deploy smoke was ignored for ~a day on 2026-07-14, and the 2026-07-25
credit-exhaustion outage ran for three days behind an incident issue nobody
was notified about (an unassigned bot-authored issue notifies no one). So on
failure both checks call `scripts/report-incident.sh`, which opens a deduped
GitHub issue titled _"🚨 production /api/ask is not returning a grounded
answer"_ (label `production`) via the built-in token, **assigned to and
@mentioning `edjchapman`** — assignment and mentions both trigger GitHub
notifications, and the assignment is re-applied idempotently on every
still-failing comment so pre-existing incidents get picked up too. The probes
pass the observed failure class along (`INCIDENT_DETAIL`, e.g.
`HTTP 502, error code upstream_error`), so billing, key, and regression causes
are distinguishable from the issue alone. Incident open/resolve transitions
additionally push to a phone (ntfy) and email when the optional repository
secrets are configured — transitions only, so a long outage pings the direct
channels twice, not hourly:

- `NTFY_TOPIC` — private ntfy.sh topic; subscribe to it in the ntfy app.
- `ALERT_SMTP_USER` / `ALERT_SMTP_PASS` / `ALERT_EMAIL_TO` (plus optional
  `ALERT_SMTP_HOST`/`ALERT_SMTP_PORT`/`ALERT_EMAIL_FROM`, defaulting to a
  Gmail app-password setup) — sent with curl's SMTP support, no third-party
  action.

Both checks share one issue, so whichever next sees a grounded answer (a later
deploy smoke or an `uptime-ask` run) auto-closes it. The issue body carries
the cause→remedy table: exhausted credit (top up — do **not** rotate), a dead
key (`make rotate-anthropic-key`), a retired model id (`ANTHROPIC_MODEL` var),
versus a code regression (`wrangler rollback`). `eval-live.yml` failures open
a separate `quality`-kind incident (own title, GitHub notification only) so
quality drift never conflates with an outage. There is deliberately no
auto-rollback — the common failure is a dead external key, which rollback
cannot fix and which would discard a good deploy.

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

`workers/www-redirect/` 301s every non-canonical hostname — `www` on the
canonical zone plus the `edchapman.co.uk` alias apex and `www` — to
`https://edwardchapman.co.uk`, preserving path and query. One carve-out: the
retired "EC Docs" site's sections (`/code_quality`, `/security`,
`/system_admin`) answer `410 Gone` on the `www` host, so search engines drop
those still-indexed URLs instead of chasing a 301 into the apex's 404.
Deployed manually (it changes ~never):

```sh
make deploy-www-redirect
```

## Alias-domain cutover: edchapman.co.uk — executed 2026-07-21

Both domains moved to Cloudflare Registrar on 2026-07-21 (Nominet IPS-tag
transfer — registration dates unchanged). `edchapman.co.uk` is an **alias**:
every web request 301s to the canonical host, and mail to it forwards to the
same destination as the canonical zone. It must never serve the site
directly (duplicate content) — the canonical host is `edwardchapman.co.uk`
everywhere.

Prior state: apex proxied to the dead Gandi origin (`A 217.70.184.38`,
HTTP 521), `www` on Gandi's defunct redirect CNAME, and a Gandi mail stack
(MX/SPF/SRV/webmail) still on the zone.

Dashboard steps (Ed): enabled Email Routing (catch-all; Cloudflare-managed
MX/SPF/DKIM replaced the Gandi records), deleted the Gandi SRV/webmail
records, replaced the dead web records with proxied placeholders
(`AAAA @/www → 100::`), and attached the apex to the `edwardchapman` worker
as a custom domain — which served the site rather than redirecting;
superseded by the steps below.

Steps executed (this repo + API token):

1. Added `edchapman.co.uk/*` and `www.edchapman.co.uk/*` routes
   (`zone_name: edchapman.co.uk`) to `workers/www-redirect` and redeployed.
   A route beats a custom domain on the same hostname, so the apex flipped
   from serving the site to the 301 the moment the routes attached.
2. Detached the `edchapman.co.uk` custom domain from the `edwardchapman`
   worker. **Trap:** detaching a custom domain also deletes the DNS record
   it adopted — the apex `AAAA → 100::` had to be recreated immediately
   after (the route kept answering; the gap was ~1s).
3. Alias zone settings: `always_use_https=on`; `min_tls_version` raised to
   `1.2` on **both** zones in the same pass.
4. Deleted the residual null SRV markers (`_imap`/`_pop3 → "."`) from both
   zones.
5. Canonical-zone SPF extended with `include:_spf.google.com` (Gmail
   send-as for the domain's address submits via Google's SMTP).
6. Verification: https on apex and `www`, with path + query → single-hop
   `301` to `https://edwardchapman.co.uk/<path>?<query>`; plain http gets
   the Always-Use-HTTPS same-host upgrade first, then the worker's 301
   (two hops, matching the canonical zone); canonical site still `200`
   with `/api/health` reporting the deployed sha; Email Routing
   `status=ready` on the alias zone; TLS 1.1 handshakes refused on both
   zones after the `min_tls_version=1.2` change.

Tracked outside the repo (dashboard-only): DNSSEC enablement on both zones,
registrar auto-renew confirmation, the Gmail send-as mailbox step, and the
DMARC ratchet (`p=none` → `quarantine`/`reject` once reports run clean).

## Diagnosing failures

- **Deploy step fails** — check the Actions log; wrangler errors name the
  config path. Token expiry/permissions are the usual suspects
  (`wrangler whoami` locally with the same token).
- **Site serves but `/api/health` 404s** — the Worker didn't deploy alongside
  assets; confirm `dist/server/wrangler.json` was used (not the repo config).
- **Wrong content serving** — compare `/api/health` sha to `main`; if stale,
  the deploy didn't run or rolled back.
- **`/api/ask` returns `upstream_unavailable` (503)** — the non-retryable
  class (ADR-0026): the Worker reached Anthropic and got an operator-actionable
  rejection, or has no credential at all. `wrangler tail --name edwardchapman`
  and read the `ask.provider_unavailable` `detail`:
  - `detail: "status 400 invalid_request_error"` → **API credit exhausted →
    top up in the [Anthropic Console](https://console.anthropic.com/) (Billing).
    Do _not_ rotate the key** — the key is valid; a `400` is billing, a `401`
    is a dead key. (This is the 2026-07-25 outage signature.)
  - `detail: "status 401 authentication_error"` → dead/rotated key → re-key via
    [Rotating the Anthropic API key](#rotating-the-anthropic-api-key).
  - `detail: "status 404 not_found_error"` → the `ANTHROPIC_MODEL` var names a
    retired model → update it in `wrangler.jsonc`.
  - `detail: "missing_model_credential"` → the Worker secret is absent → set it
    (see [Secrets](#secrets)).
- **`/api/ask` returns `upstream_error` (502)** — the transient class: a
  provider `500`/`529` or a connection timeout. Usually self-heals; confirm
  with `wrangler tail` (look for `ask.provider_error` / `ask.provider_timeout`)
  and retry before acting.
- Both: questions that don't clear the retrieval confidence gate return a 200
  refusal regardless, so probe with a question known to retrieve (e.g. the
  smoke question above).
- **CSP console errors on the live site only ("Executing inline script
  violates … script-src"), with a hash that changes on every load** — that is
  not the build. Cloudflare **Bot Fight Mode** injects an inline
  challenge-platform script (`window.__CF$cv$params` →
  `/cdn-cgi/challenge-platform/…`) into HTML at the edge; its content embeds a
  per-request token, so it can never be hash-allowlisted and the strict CSP
  (correctly) blocks it. The site itself is unaffected — the pinned Astro
  island hashes still match (verify: hash each inline `<script>` in a fetched
  live page and compare with `public/_headers`). The same injected iframe
  produces the "Unrecognized feature" Permissions-Policy warnings. Fix at the
  zone, not in the CSP: Cloudflare dashboard → Security → Bots → turn Bot
  Fight Mode off (dashboard-only; the deploy token cannot change it). Do not
  add `unsafe-inline` to accommodate it.
