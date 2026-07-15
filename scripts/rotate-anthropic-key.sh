#!/usr/bin/env bash
# Rotate ANTHROPIC_API_KEY across its authoritative stores in one command
# (ADR-0014). Centralises the *action*, not the storage: it encodes the
# Cloudflare versioned-deploy two-step — `versions secret put` uploads a new
# version at 0% traffic, `versions deploy` promotes it — which, done by hand,
# caused the 2026-07-15 /api/ask outage (the promote step was skipped). Then it
# sets the GitHub `production`-env copy and verifies the live endpoint.
#
# The key value is read once from a hidden prompt, piped to each store over
# stdin (never on argv, never in shell history), and cleared afterwards. The
# optional local `ANTHROPIC_API_KEY_EDWARDCHAPMAN` (for `make eval-agent-live`)
# is not an authoritative store and is intentionally out of scope — see
# docs/deployment.md and ADR-0014.
set -euo pipefail

WORKER_NAME="edwardchapman"
SECRET_NAME="ANTHROPIC_API_KEY"
GH_ENV="production"
SITE="https://edwardchapman.co.uk"
PROBE_QUESTION='How did Foreman handle reliable event processing?'

note() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# --- Preflight: tools + auth, fail early rather than mid-rotation -------------
command -v pnpm >/dev/null || fail "pnpm not found"
command -v gh >/dev/null || fail "gh (GitHub CLI) not found"
command -v jq >/dev/null || fail "jq not found"
command -v curl >/dev/null || fail "curl not found"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated (run: gh auth login)"
pnpm exec wrangler whoami >/dev/null 2>&1 ||
  fail "wrangler is not authenticated (check Cloudflare creds; see docs/deployment.md)"

# --- Read the new key once, hidden, with confirmation ------------------------
printf 'Paste the new %s value (input hidden): ' "$SECRET_NAME"
read -rs KEY1
echo
printf 'Confirm: '
read -rs KEY2
echo
[ -n "$KEY1" ] || fail "empty value"
[ "$KEY1" = "$KEY2" ] || fail "the two values do not match"
unset KEY2

# --- 1. Cloudflare Worker: store in a new version, then promote it to 100% ----
note "Cloudflare Worker: storing $SECRET_NAME in a new version"
if ! put_out=$(printf '%s' "$KEY1" | pnpm exec wrangler versions secret put "$SECRET_NAME" --name "$WORKER_NAME" 2>&1); then
  printf '%s\n' "$put_out"
  fail "wrangler versions secret put failed"
fi
printf '%s\n' "$put_out"

# The promote step needs the id of the version we just created; parse it from
# the command's own output (a UUID). Skipping this promote is exactly the trap
# that caused the outage, so it is automated, not left to the operator.
version_id=$(printf '%s' "$put_out" |
  grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | tail -1 || true)
[ -n "$version_id" ] ||
  fail "could not read the new version id from wrangler output; promote it manually: pnpm exec wrangler versions deploy <id>@100% --name $WORKER_NAME"

note "Cloudflare Worker: promoting version $version_id to 100% traffic"
pnpm exec wrangler versions deploy "${version_id}@100%" --name "$WORKER_NAME" --yes

# --- 2. GitHub production-environment secret (consumed by eval-live.yml) ------
note "GitHub: setting $SECRET_NAME in the $GH_ENV environment"
printf '%s' "$KEY1" | gh secret set "$SECRET_NAME" --env "$GH_ENV"

unset KEY1

# --- 3. Verify the live endpoint returns a *grounded* answer ------------------
# Same invariant the deploy smoke and uptime-ask monitor assert: a refusal
# (sources: []) or an upstream_error 502 both fail this. A couple of retries
# absorb edge propagation without masking a genuinely dead key.
note "Verifying $SITE/api/ask returns a grounded answer"
payload=$(jq -nc --arg q "$PROBE_QUESTION" '{question: $q}')
ok=""
for i in 1 2 3; do
  body=$(curl -sS -X POST "$SITE/api/ask" -H 'content-type: application/json' \
    -d "$payload" --max-time 30 || true)
  if printf '%s' "$body" | jq -e '.sources | length > 0' >/dev/null 2>&1; then
    ok=1
    break
  fi
  echo "attempt $i: not grounded yet, retrying in 5s..."
  sleep 5
done
[ -n "$ok" ] ||
  fail "live /api/ask did not return a grounded answer — inspect: pnpm exec wrangler tail --name $WORKER_NAME (look for ask.provider_error)"

note "Done — $SECRET_NAME rotated in the Worker and GitHub $GH_ENV env; /api/ask is answering."
echo "  · Optional between-deploys check: gh workflow run uptime-ask.yml"
echo "  · Optional local evals: update ANTHROPIC_API_KEY_EDWARDCHAPMAN where you export it."
