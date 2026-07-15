# ADR-0014: Centralise Anthropic key rotation as one command, not one store

**Status:** Accepted (2026-07-15)

## Context

The Anthropic API key is consumed in three independent stores, each on a
different platform with a different consumer (docs/deployment.md, "Secrets"):

- the **Cloudflare Worker** secret, read as `env.ANTHROPIC_API_KEY` to answer
  production `/api/ask`;
- the **GitHub `production` environment** secret, read by `eval-live.yml` for
  the live agent evaluation (ADR-0008);
- an optional **local shell var** `ANTHROPIC_API_KEY_EDWARDCHAPMAN` for
  `make eval-agent-live`.

Rotation is therefore a three-place manual procedure, and on 2026-07-15 it
failed in production: the Worker key was updated with `wrangler versions secret
put` (which uploads a _new version_ at 0% traffic) but the promoting
`wrangler versions deploy` step was never run, so `/api/ask` kept serving an
old version with a rejected key and returned `upstream_error` (502) for every
retrieval-clearing question. The incident exposed two failure modes of a
hand-run multi-store rotation: an easy-to-miss step (the versioned-deploy
two-step) and no single place that encodes the correct sequence.

A hard constraint shapes the options. A Worker reads its secret from `env` at
request time; it cannot fetch from an external vault on the hot path without
adding another binding, another secret, and latency. So the Worker's copy must
be _pushed to Cloudflare_ — zero-copy centralisation of storage is not
achievable for the one store that actually serves users. The realistic goal is
**one source of truth plus an automated push**, or, more cheaply, **one command
that performs the whole rotation correctly**.

## Decision

Centralise the rotation **action**, not the **storage**.

- Keep the Cloudflare Worker secret and the GitHub `production` environment
  secret as the two authoritative copies. They serve genuinely different
  platforms (request-time Worker vs CI runner) and cannot share physical
  storage without new infrastructure; duplicating the value across exactly
  these two is accepted, not a defect.
- Demote the local `ANTHROPIC_API_KEY_EDWARDCHAPMAN` from a rotation target to
  a purely optional, developer-local convenience: live evals run in CI
  (`eval-live.yml`, dispatch or the weekly cron) by default, so the local copy
  is not required to exist and is not counted as a place a rotation must touch.
  Net authoritative stores: **two**.
- Add a `make rotate-anthropic-key` target that performs the full rotation in
  one command: prompt for the value once (never on argv — `gh`/`wrangler`
  already read it from a prompt, keeping it out of shell history), run
  `wrangler versions secret put` **then** `wrangler versions deploy` (the
  two-step encoded so it cannot be half-run), `gh secret set --env production`,
  and finish with the grounded-answer probe from docs/deployment.md and a
  reminder to dispatch the `uptime-ask` monitor. The Makefile becomes the
  single home for the operational knowledge; docs/deployment.md's rotation
  section points at it rather than re-listing hand commands.

The operational knowledge — the versioned-deploy trap, the verification probe —
moves out of prose (which is not executed and rots) and into a target (which
is). This is deliberately a low-infrastructure change: no new dependency, no
new account, no secrets-manager onboarding.

## Alternatives considered

- **Single source of truth via a secrets manager (1Password / Vault).** Store
  the key once; make the copies _derived_: `1password/load-secrets-action`
  injects it into CI at runtime (GitHub then holds a service-account token, not
  the Anthropic key), `op read` supplies the local var, and the same source
  scripts the push to the Worker. This is the "correct" centralisation and is
  recorded as the graduation path — but for a solo, two-authoritative-store
  setup it trades a rare manual step for a standing dependency, a service
  account to manage, and its own token to rotate. Rejected **now**; see revisit
  conditions.
- **Cloudflare Secrets Store.** An account-level secret bound into the Worker
  (`secrets_store_secrets`) so the value lives once at account scope. It
  addresses only the Worker copy — not GitHub or local — and the benefit of
  account-scoping accrues when several Workers share a secret; there is one
  Worker today. Rejected now; revisit if the Worker count grows.
- **Status quo (three hand-updated stores, prose runbook).** The 2026-07-15
  incident is the evidence against it: the runbook was correct and still
  produced a half-completed rotation. Rejected.

## Relations

Complements ADR-0008: the GitHub `production` key exists because of the
deterministic/live evaluation split, and this ADR keeps that copy while
clarifying that the local eval copy is optional. Does not amend the content or
retrieval ADRs. Sits alongside the ask-endpoint monitoring change (deploy-time
grounded-answer smoke + the `uptime-ask` synthetic monitor) that surfaced from
the same incident: monitoring detects a bad key; this ADR reduces the chance of
producing one.

## Consequences

- Rotation becomes a single command, and the versioned-deploy two-step can no
  longer be forgotten or half-run — the failure mode behind the 2026-07-15
  outage is designed out.
- Authoritative stores drop from three to two; the local var is explicitly
  optional and unversioned.
- No new infrastructure, dependency, or account. The value is still duplicated
  across the Worker and GitHub — accepted, because they are different platforms
  and the `make` target keeps them in sync in one step.
- The Makefile now carries operational knowledge that must stay correct;
  docs/deployment.md defers to it, so the two cannot drift into disagreement.
- A rotation still requires the operator to have both `wrangler` (Cloudflare
  auth) and `gh` (GitHub auth) available locally; CI does not self-rotate.

## Revisit conditions

- The number of keys or consuming services grows (more Workers, more secrets,
  more environments) — adopt the secrets-manager single-source-of-truth
  (1Password/Vault) alternative.
- The project stops being solo — audited, access-controlled central storage
  becomes worth its overhead.
- Cloudflare Secrets Store (or an equivalent) gains a clean CI/GitHub
  integration that removes a copy rather than adding a binding — reconsider
  account-scoped storage for the Worker side.
