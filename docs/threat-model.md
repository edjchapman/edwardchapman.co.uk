# Threat model

What can go wrong, what defends against it, and where the residual risk
sits. Completed with the Phase-3 agent foundation; revisit whenever a new
surface ships. Mitigations marked _(P4)_ land with the live model
integration.

## Assets

- **Anthropic API key** — Worker secret _(P4)_; never client-side, never in
  the repo or logs.
- **Cloudflare deploy token** — GitHub Actions secret + local `~/.secrets`
  file; deliberately scoped (Workers Scripts/Routes, DNS, zone settings — no
  account-wide or ruleset scopes).
- **The public-content boundary** — nothing private may ship (ADR-0007).
- **Availability and spend** — the site must stay up; the agent must not be
  a cost amplifier.
- **Answer integrity** — the agent must not make unsupported claims in Ed's
  name.

## Trust boundaries

| Boundary                       | Defence                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public repo ↔ private material | Content-policy scanner in `make check` (fail-closed email allowlist, private-repo tripwire); PR checklist; corpus builder re-scans its own output                                                                   |
| Build time ↔ request time      | Corpus is a build artefact imported into the Worker — never fetched, never served as an asset (ADR-0005)                                                                                                            |
| Static assets ↔ Worker         | Assets serve without invoking code; only `/api/*` executes (ADR-0003)                                                                                                                                               |
| User input ↔ model prompt      | Validation + length caps → deterministic retrieval over published corpus only → fixed system policy → typed search-result blocks with API-enforced citations → index-bounds citation whitelist (spec §11, ADR-0012) |
| Canonical host ↔ previews      | `/api/ask` host gate: non-canonical hosts (incl. `pr-*` preview URLs) get 404                                                                                                                                       |

## Threats and mitigations

| Threat                                     | Mitigations                                                                                                                                                                                                                                                                                                                                                                             | Residual risk                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Secret leakage                             | Worker/Actions secrets; ggshield pre-commit scan; no `.dev.vars` committed; build sanitizer removes and rejects local environment files under `dist/`; structured logs never carry keys (ADR-0018)                                                                                                                                                                                      | Local `~/.secrets` file depends on machine hygiene (transcript-exposed token rolled 2026-07-13, old secret invalidated) |
| Prompt injection (question or corpus text) | Corpus is self-authored; retrieval scoping; evidence and question travel as separately typed blocks; system policy treats search results as evidence; response validation rejects policy-leak fingerprints; index-bounds citation whitelist; adversarial suite in CI                                                                                                                    | A sufficiently subtle live-model leak; bounded by live evals + red team _(P4)_                                          |
| Unsupported claims / hallucination         | Grounded-only policy; refusal below retrieval confidence (2-term + threshold gate); citations attached by the API to supplied source spans — fabricated citation targets not expressible (ADR-0012); zero-citation answers become refusals; golden claims checked in live evals _(P4)_                                                                                                  | Miscontextualised or uncited claims (uncited ⇒ refusal); judge bias in live scoring                                     |
| Private-content inclusion                  | ADR-0007 machinery (scanner, draft/corpus flags, fixtures)                                                                                                                                                                                                                                                                                                                              | Novel sensitive categories need new rules                                                                               |
| Build-artefact / source-map leakage        | Corpus imported not served; no source maps in production build; local environment files removed and rejected after build; dist-link checker catches accidental references                                                                                                                                                                                                               | A failed build may leave incomplete ignored output; never publish `dist/` outside the documented deploy command         |
| API cost abuse / flooding                  | Rate-limit binding (10/min/IP, ADR-0009, verified live 2026-07-13); 4 KB body + 500-char question caps; host gate; `max_tokens` bound + AI Gateway caps _(P4)_. Bot Fight Mode deliberately **off**: it challenges by IP/ASN across all paths, breaking `/api/ask` for `fetch()` clients (challenges are unsolvable in XHR) and the CI deploy smoke; the caps above bound abuse instead | Distributed abuse → WAF/Turnstile via new ADR                                                                           |
| Oversized payloads                         | Byte-cap before JSON parse; zod length cap after normalisation                                                                                                                                                                                                                                                                                                                          | —                                                                                                                       |
| Malicious markup in model output           | Answers rendered as text only (no HTML from model); citation markers derived by index arithmetic over the plain answer string, never from model markup; response contract validated                                                                                                                                                                                                     | —                                                                                                                       |
| Log injection / over-logging               | Structured JSON events with fixed fields; question/answer text never logged; provider detail truncated                                                                                                                                                                                                                                                                                  | —                                                                                                                       |
| Dependency / supply chain                  | Frozen lockfile; dependabot weekly; pnpm build-script allowlist; 24h package cooldown (`minimumReleaseAge`, pinned in `pnpm-workspace.yaml`); minimal dependency surface (see colophon)                                                                                                                                                                                                 | Upstream compromise inside allowed packages surviving the cooldown window                                               |
| Deploy-token compromise                    | Minimal scopes; repo secrets; rotate on suspicion                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                       |
| Preview-environment exposure               | Previews can't alter production routing (`versions upload`); `/api/ask` host-gated; `workers.dev` disabled for production; preview URLs public by design (accepted, revisit if content pre-releases become sensitive)                                                                                                                                                                   | Public preview HTML of unmerged PRs                                                                                     |

## Data retention

No analytics or cookies. Worker structured logs (redacted, no question text)
live in Cloudflare's Workers Logs with its default retention. Questions sent
to the agent are processed by Anthropic per their API data policy _(P4;
stated on /ask and /privacy before launch)_. Nothing else is stored — there
is no database.

## Standing review triggers

New `prerender = false` routes; new corpus sources; any new secret; any new
third-party service; enabling analytics of any kind.
