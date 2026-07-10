---
title: "Foreman"
problem: "Background job systems routinely lose or duplicate work at the crash boundary between committing to the database and publishing to a queue."
built: "A Django/DRF + Celery pipeline on PostgreSQL and Redis: jobs and outbox events commit atomically, workers process exactly-once via idempotency keys, failures retry with capped backoff into a redrivable dead-letter queue, and progress streams live over WebSockets."
differentiator: "Reliability is measured, not asserted — Locust load tests with Prometheus metrics; moving dispatch to Postgres LISTEN/NOTIFY cut queue-wait p95 from 1.84s to 0.34s."
tech:
  - Python
  - Django
  - Celery
  - PostgreSQL
  - Redis
  - React
  - Docker
featured: true
order: 1
draft: false
repo: "https://github.com/edjchapman/Foreman"
demo: "https://foreman-demo.up.railway.app"
---

Case study to follow in Phase 2 (see docs/spec.md, delivery phases).
