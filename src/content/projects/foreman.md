---
title: "Foreman"
problem: "A production-style background job system designed around one of distributed computing's most common failure modes: work being lost or duplicated between a database commit and queue publication."
built: "Built with Django, Django REST Framework, Celery, PostgreSQL, and Redis, Foreman uses the transactional outbox pattern to commit jobs and dispatch events atomically. Workers process jobs safely using idempotency keys, failed tasks retry with capped exponential backoff, and exhausted jobs move to a redrivable dead-letter queue. Live progress updates are streamed to clients over WebSockets."
differentiator: "Reliability is demonstrated rather than assumed. Locust load tests and Prometheus metrics expose throughput, latency, retries, and failure behaviour. Replacing polling-based dispatch with PostgreSQL LISTEN/NOTIFY reduced p95 queue wait time from 1.84 seconds to 0.34 seconds."
tech:
  - Python
  - Django
  - Celery
  - PostgreSQL
  - Redis
  - Terraform
  - Docker
featured: true
order: 1
draft: false
repo: "https://github.com/edjchapman/Foreman"
demo: "https://foreman-demo.up.railway.app"
---

## Context

Foreman is a deliberately small product with deliberately large guarantees:
one CSV import pipeline — submit a property CSV, get a report back — engineered
so that the interesting part is everything that can go wrong between
"202 Accepted" and "here's your report". It's live, watchable, and every
decision was recorded as an ADR in the repository at the moment it was made.

## Problem

Submitting a job must write PostgreSQL _and_ enqueue Celery work — two systems
with no shared transaction. Write-then-enqueue loses the job if the process
dies in between; enqueue-then-write hands workers a phantom. That's the
classic dual-write problem, and the common "just call `task.delay()` in the
view" pattern quietly has it. Downstream of that sit the sibling problems:
duplicate effects under redelivery, poison input burning retries, workers
dying mid-job, and a UI that lies about state.

## Constraints

- Delivery guarantees had to be real under crash conditions, not fair-weather.
- Every reliability claim had to be observable and testable — CI runs against
  real PostgreSQL because the locking behaviour (`SKIP LOCKED`) is a
  Postgres-runtime property.
- Dependency restraint throughout: a ~25-line stdlib JSON log formatter over
  structlog; a vendored no-build-step Alpine.js for the demo console.

## Architecture

```text
POST /api/v1/jobs/ → transactional outbox → relay → idempotent worker
     (atomic)         (at-least-once)              (exactly-once effect,
                                                    retries, DLQ, lease)
   → live WebSocket status → streamed CSV report
```

Job and `OutboxEvent` commit in one transaction; a relay publishes PENDING
events (multiple relays claim disjoint batches with
`SELECT … FOR UPDATE SKIP LOCKED`). Workers own exactly-once _effect_ through
a state guard plus a per-job natural-key constraint. Failures are classified:
poison input fails fast; everything else retries with capped full-jitter
backoff into a redrivable dead-letter queue. Job state streams over Django
Channels — snapshot on connect, then deltas.

## Important engineering decisions

- **Retry state lives in Postgres, not the broker.** Celery's native
  `self.retry()` is broken against this design — it redelivers while the job
  is still PROCESSING, the state guard skips it, and the job strands.
  Database-driven retries are queryable, survive broker restarts, and later
  turned out to be exactly what the realtime layer needed.
- **Leases with fencing tokens for crash recovery.** A claim takes a lease; a
  reaper returns expired-lease jobs to PENDING. Because a reaped worker might
  be slow rather than dead, every claim stamps a fresh fencing token — a late
  write from the original worker matches zero rows instead of clobbering the
  re-claimed job.
- **Observability before UI, DB-derived throughout.** Queue depths, ages,
  throughput counters and latency histograms are computed from Postgres at
  scrape time, because worker, Beat, and web are separate containers and
  process-local counters are cross-process lies.
- **Measure, then act: push dispatch.** Load testing showed queue wait
  dominated by the 1s poll, so a Postgres `AFTER INSERT` trigger now
  `pg_notify`s a listener that dispatches in milliseconds — with the poll kept
  as a healing fallback. Queue-wait p50 733ms → 41ms, p95 1.84s → 0.34s,
  end-to-end latency halved.
- **Tracing across the outbox seam.** OpenTelemetry can't propagate context
  through a row written now and read later, so the W3C `traceparent` rides the
  outbox row's existing JSON payload and is re-hydrated at dispatch — one
  connected trace per job across four processes.

## Alternatives considered

Broker-native retries (rejected: strands jobs against the state guard),
structlog (rejected: seven call sites don't earn a dependency),
process-local Prometheus counters (rejected: wrong across containers),
and polling UIs (rejected: the E2E suite literally asserts the page never
polls).

## Testing and quality approach

CI runs against real PostgreSQL with a 90% coverage floor; async seams are
tested at the right altitude (`django_capture_on_commit_callbacks`,
`WebsocketCommunicator`, eager-Celery fixtures); pytest runs strict — any
warning fails CI. Playwright E2E runs against the _deployed_ platform: a
sample import succeeds over the WebSocket, the CSV downloads, and a poison
job fails without retries.

## Operational or deployment model

Conventional Commits → release-please → GHCR image with SLSA build
provenance → Railway deploy pinned to the exact semver tag, web first (its
pre-deploy `migrate` and `/readyz` gate the fleet). The platform is
Terraform-declared; `terraform destroy`/`apply` is the demo's off/on switch.

## Outcome

A live system whose reliability properties are demonstrated rather than
claimed: at-least-once delivery with exactly-once effect, autonomous crash
recovery, measured latency improvements from a measured bottleneck, and a
demo console where you can watch a flaky job recover and a dead-lettered job
get redriven.

## Current limitations

- One residual at-least-once window is documented rather than patched: a
  dispatch message permanently lost after its outbox event was marked
  DISPATCHED is recovered only by broker-level `acks_late`.
- WebSocket connections carry no per-connection auth or metrics yet.
- `rows_imported` reports target state, not rows-inserted-this-run — the only
  semantic that stays truthful under redelivery, but it can surprise.

## What I'd do next

WebSocket metrics and per-connection auth; remote CSV sources (`s3://`,
`https://`) behind the existing ingest seam; relaxing the now-fallback Beat
poll to cut idle database load.

## Relevant links

- [Repository](https://github.com/edjchapman/Foreman) — including the full
  [case study](https://github.com/edjchapman/Foreman/blob/main/docs/case-study.md)
  and ADR trail this page summarises
- [Live demo](https://foreman-demo.up.railway.app)
