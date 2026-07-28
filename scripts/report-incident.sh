#!/usr/bin/env bash
# Turn a failed production check into a tracked, notifying GitHub issue rather
# than an ignorable red workflow run. Motivation, twice over: the 2026-07-14
# dark-mode deploy shipped over a red post-deploy smoke (dead Anthropic key)
# that sat unactioned for ~a day, and the 2026-07-25 credit-exhaustion outage
# sat for three days behind an issue nobody was notified about. A red X is not
# an alert for a solo maintainer — and neither is an unassigned bot issue. So
# incidents are assigned to and @mention the maintainer (GitHub notifies for
# both), and state *transitions* (open/resolve) additionally push to the
# direct channels below when their secrets are configured. Called by
# deploy.yml, uptime-ask.yml, redteam-live.yml, and eval-live.yml:
#
#   report-incident.sh fail "<source>" [kind]  -> open or comment the deduped issue
#   report-incident.sh ok   "<source>" [kind]  -> close any open issue of that kind
#
# Optional environment:
#   INCIDENT_DETAIL  observed failure summary (e.g. "HTTP 502, error code
#                    upstream_error"), appended to the issue body and comments
#   NTFY_TOPIC       private ntfy.sh topic -> phone push on open/resolve
#   ALERT_SMTP_USER / ALERT_SMTP_PASS / ALERT_EMAIL_TO  -> email on
#                    open/resolve via curl's SMTP support; optional
#                    ALERT_SMTP_HOST/ALERT_SMTP_PORT/ALERT_EMAIL_FROM default
#                    to a Gmail app-password setup
#
# Dedup is by exact issue title, so the deploy smoke and the uptime monitor
# share one incident: whichever next sees a grounded answer closes it. Uses gh
# + the built-in GITHUB_TOKEN only; the push/email channels are optional
# extras that no-op when unconfigured, and their failures never fail the
# calling monitor. No-ops entirely when gh is unauthenticated (e.g. run
# locally), so it is safe outside CI.
set -euo pipefail

STATUS="${1:?usage: report-incident.sh <fail|ok> <source> [grounded|security|quality]}"
SOURCE="${2:-unknown}"
# Optional 3rd arg selects the incident kind, so distinct monitors keep distinct
# (deduped) issues. Default is the /api/ask groundedness outage for the existing
# callers (deploy.yml, uptime-ask.yml), which pass only two args.
KIND="${3:-grounded}"
ASSIGNEE="edjchapman"
case "$KIND" in
  security)
    TITLE="🚨 production security probe is failing"
    CONDITION="one or more live security invariants (headers, edge injection, refusal, rate limit) regressed"
    REMEDY=$'- Cloudflare edge setting re-enabled (Bot Fight Mode / JS Detections re-injecting) \xE2\x86\x92 docs/threat-model.md (API-Enforced Content Security Policy row) and docs/deployment.md.\n- A `public/_headers` regression in the last deploy weakened the CSP \xE2\x86\x92 `pnpm exec wrangler rollback` (docs/deployment.md \xE2\x86\x92 Rollback), then fix on a branch.\n- An agent refusal/leak regression \xE2\x86\x92 reproduce with `make redteam-live` and see docs/red-team.md.'
    ;;
  quality)
    TITLE="🚨 live agent evaluation is failing its thresholds"
    CONDITION="failing its live evaluation thresholds (quality drift on the live model path)"
    REMEDY=$'- Reproduce locally with `make eval-agent-live` (needs an `ANTHROPIC_API_KEY`; docs/evaluation.md).\n- Check the `eval-report.json` artifact on the failing run for the dimension that dipped.\n- Fix the behaviour, or record a justified threshold change in docs/evaluation.md \xE2\x80\x94 never lower a bar silently.'
    ;;
  *)
    TITLE="🚨 production /api/ask is not returning a grounded answer"
    CONDITION="not returning a grounded answer (a non-empty \`sources\` array on an HTTP 200)"
    REMEDY=$'- API credit exhausted (tail detail `status 400 invalid_request_error`) \xE2\x86\x92 top up at https://console.anthropic.com/ (Billing) \xE2\x80\x94 do **not** rotate the key.\n- Dead/rotated Anthropic key (tail detail `status 401 authentication_error`) \xE2\x86\x92 `make rotate-anthropic-key` (docs/deployment.md).\n- Retired model id (tail detail `status 404 not_found_error`) \xE2\x86\x92 update the `ANTHROPIC_MODEL` var in `wrangler.jsonc`.\n- Transient provider trouble or timeout \xE2\x86\x92 usually self-heals; confirm with `pnpm exec wrangler tail --name edwardchapman` (look for `ask.provider_error` / `ask.provider_timeout`).\n- Code regression in the last deploy \xE2\x86\x92 `pnpm exec wrangler rollback` (docs/deployment.md \xE2\x86\x92 Rollback).'
    ;;
esac
LABEL="production"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"

# Push open/resolve transitions to the direct channels (phone, email) when
# configured. Per-comment noise stays on GitHub — the assignee is notified for
# every comment there — so a multi-day outage pings the phone twice, not
# hourly. Channel failures never fail the monitor run.
notify_transition() {
  local transition="$1" issue_url="$2"
  local message="$transition: $TITLE
Source: $SOURCE${INCIDENT_DETAIL:+
Observed: $INCIDENT_DETAIL}
$issue_url"
  if [ -n "${NTFY_TOPIC:-}" ]; then
    if curl -fsS -m 10 -H "Title: edwardchapman.co.uk production" \
      -d "$message" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1; then
      echo "ntfy push sent"
    else
      echo "ntfy push failed (non-fatal)"
    fi
  fi
  if [ -n "${ALERT_SMTP_PASS:-}" ] && [ -n "${ALERT_EMAIL_TO:-}" ]; then
    local from="${ALERT_EMAIL_FROM:-${ALERT_SMTP_USER:-}}"
    if printf 'From: %s\r\nTo: %s\r\nSubject: %s: production incident (%s)\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n' \
      "$from" "$ALERT_EMAIL_TO" "$transition" "$SOURCE" "$message" |
      curl -fsS -m 20 --url "smtps://${ALERT_SMTP_HOST:-smtp.gmail.com}:${ALERT_SMTP_PORT:-465}" \
        --mail-from "$from" --mail-rcpt "$ALERT_EMAIL_TO" \
        --user "${ALERT_SMTP_USER:-}:${ALERT_SMTP_PASS}" -T - >/dev/null 2>&1; then
      echo "alert email sent"
    else
      echo "alert email failed (non-fatal)"
    fi
  fi
}

if ! gh auth status >/dev/null 2>&1; then
  echo "report-incident: gh not authenticated; skipping (expected only outside CI)"
  exit 0
fi

# Existing open incident (match by exact title; passed to jq via env to dodge
# quoting the emoji into the filter). Empty if none.
existing=$(TITLE_ENV="$TITLE" gh issue list --state open --limit 100 \
  --json number,title --jq 'map(select(.title == env.TITLE_ENV)) | .[0].number // empty')

if [ "$STATUS" = "ok" ]; then
  if [ -n "$existing" ]; then
    gh issue close "$existing" \
      --comment "Recovered: \`$SOURCE\` passed again ($RUN_URL). Auto-closing."
    echo "closed incident #$existing"
    issue_url=$(gh issue view "$existing" --json url --jq .url 2>/dev/null || echo "$RUN_URL")
    notify_transition "RESOLVED" "$issue_url"
  else
    echo "no open incident to close"
  fi
  exit 0
fi

if [ "$STATUS" != "fail" ]; then
  echo "unknown status '$STATUS' (expected fail|ok)" >&2
  exit 2
fi

if [ -n "$existing" ]; then
  # Assignment is idempotent and retro-fixes incidents opened before this
  # script assigned anyone (e.g. a long-running outage issue).
  gh issue edit "$existing" --add-assignee "$ASSIGNEE" >/dev/null 2>&1 ||
    echo "could not add assignee (non-fatal)"
  gh issue comment "$existing" \
    --body "Still failing — \`$SOURCE\` ($RUN_URL).${INCIDENT_DETAIL:+ Observed: $INCIDENT_DETAIL}"
  echo "incident #$existing already open; commented"
  exit 0
fi

detail_block=""
if [ -n "${INCIDENT_DETAIL:-}" ]; then
  detail_block="Observed: $INCIDENT_DETAIL"$'\n\n'
fi

read -r -d '' body <<BODY || true
@$ASSIGNEE — \`$SOURCE\` found production $CONDITION. Production is degraded now.

${detail_block}Run: $RUN_URL

**Likely cause → remedy**

$REMEDY

Auto-closes when a later run of the same monitor passes again.
BODY

gh label create "$LABEL" --color B60205 --description "Production incident" 2>/dev/null || true
url=$(gh issue create --title "$TITLE" --label "$LABEL" --assignee "$ASSIGNEE" --body "$body")
echo "opened incident: $url"
notify_transition "OPEN" "$url"
