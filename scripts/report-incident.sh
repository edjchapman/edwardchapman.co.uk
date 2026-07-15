#!/usr/bin/env bash
# Turn a failed production check into a tracked, notifying GitHub issue rather
# than an ignorable red workflow run. Motivation: the 2026-07-14 dark-mode
# deploy shipped over a red post-deploy smoke (dead Anthropic key) that sat
# unactioned for ~a day — a red X is not an alert for a solo maintainer, but an
# open issue notifies and persists. Called by deploy.yml and uptime-ask.yml:
#
#   report-incident.sh fail "<source>"  -> open a deduped incident issue
#   report-incident.sh ok   "<source>"  -> close any open incident issue
#
# Dedup is by exact issue title, so the deploy smoke and the uptime monitor
# share one incident: whichever next sees a grounded answer closes it. Uses gh +
# the built-in GITHUB_TOKEN only — no external service or secret. No-ops when gh
# is unauthenticated (e.g. run locally), so it is safe outside CI.
set -euo pipefail

STATUS="${1:?usage: report-incident.sh <fail|ok> <source>}"
SOURCE="${2:-unknown}"
TITLE="🚨 production /api/ask is not returning a grounded answer"
LABEL="production"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"

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
      --comment "Recovered: \`$SOURCE\` saw a grounded answer again ($RUN_URL). Auto-closing."
    echo "closed incident #$existing"
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
  gh issue comment "$existing" --body "Still failing — \`$SOURCE\` ($RUN_URL)."
  echo "incident #$existing already open; commented"
  exit 0
fi

read -r -d '' body <<BODY || true
\`$SOURCE\` found production \`/api/ask\` not returning a grounded answer (a
non-empty \`sources\` array on an HTTP 200). Production is degraded now.

Run: $RUN_URL

**Likely cause → remedy**

- Dead/rotated Anthropic key (502 \`upstream_error\`) → \`make rotate-anthropic-key\` (docs/deployment.md).
- Code regression in the last deploy → \`pnpm exec wrangler rollback\` (docs/deployment.md → Rollback).
- Transient upstream/edge blip → confirm with \`pnpm exec wrangler tail --name edwardchapman\` (look for \`ask.provider_error\`).

Auto-closes when a later deploy smoke or \`uptime-ask\` run sees a grounded answer.
BODY

gh label create "$LABEL" --color B60205 --description "Production incident" 2>/dev/null || true
url=$(gh issue create --title "$TITLE" --label "$LABEL" --body "$body")
echo "opened incident: $url"
