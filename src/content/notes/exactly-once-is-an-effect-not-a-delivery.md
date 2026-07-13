---
title: "Exactly-once effects in an at-least-once pipeline"
description: "How a transactional outbox, idempotent writes, leases, and fencing tokens combine to give database effects exactly-once behaviour while delivery remains at-least-once."
pubDate: 2026-07-13
tags:
  - backend
  - reliability
  - distributed-systems
draft: false
relatedProject: foreman
---

Delivery semantics and effect semantics describe different boundaries. Some
platforms provide exactly-once processing within a constrained transaction;
for example,
[Kafka documents exactly-once processing](https://kafka.apache.org/42/design/design/#message-delivery-semantics)
when reading, processing, and writing Kafka records transactionally. That
guarantee does not automatically extend to an external database, email
provider, or third-party API.

[Foreman](https://edwardchapman.co.uk/projects/foreman) uses Celery,
PostgreSQL, and Redis. Its delivery path is at-least-once, while the database
is designed to converge on the same state when work is repeated. The public
[case study](https://github.com/edjchapman/Foreman/blob/main/docs/case-study.md)
and
[transactional-outbox ADR](https://github.com/edjchapman/Foreman/blob/main/docs/adr/0001-transactional-outbox.md)
describe the implementation and its failure windows.

## Transactional outbox

Writing a domain row and then publishing a message creates a dual-write
problem. If the process stops between those operations, the row can commit
without the message being published.

Foreman writes the `Job` and its `OutboxEvent` in one PostgreSQL transaction.
A relay later publishes pending events. Parallel relays use
`SELECT … FOR UPDATE SKIP LOCKED` to claim different rows without waiting for
one another; PostgreSQL documents this as an appropriate use of `SKIP LOCKED`
for
[multiple consumers of a queue-like table](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE).

The row lock prevents concurrent relays from claiming the same pending event.
It does not remove redelivery: if the relay publishes and stops before its
database transaction commits, the row remains pending and is published again.
The consumer must therefore tolerate duplicate messages.

## Idempotent effects

Foreman uses two database controls:

- a **state guard** claims a job only while it is `PENDING`; and
- a **natural-key constraint** on `(job, external_id)` prevents repeated
  imports from creating duplicate property records.

The constraint is the final protection when two attempts overlap. It is
enforced by PostgreSQL rather than by an earlier read that could become stale
under concurrency.

Failure handling follows the categories in the public
[worker implementation](https://github.com/edjchapman/Foreman/blob/main/jobs/tasks.py):
permanent ingest errors move directly to `FAILED`; transient errors retry with
capped full-jitter backoff and move to the redrivable `DEAD_LETTER` state only
after the attempt limit is reached. Retry state is stored in PostgreSQL so it
remains queryable and survives broker restarts.

## Leases and fencing tokens

A worker can be slow rather than dead. If its lease expires, a reaper may
return the job to `PENDING` and another worker may claim it while the original
attempt is still running.

Each Foreman claim receives a new lease token. Terminal and retry updates are
conditional on the job still being `PROCESSING` with that token. A late update
from an earlier claimant therefore matches no row. The natural-key constraint
independently keeps repeated record inserts idempotent.

Broker late acknowledgements and visibility timeouts cover a different window:
a worker failure before the claim commits. After a claim commits, Foreman's
state guard prevents ordinary broker redelivery from processing the job again,
so the lease reaper is responsible for recovery.

## Limitations

The guarantee is scoped to state held behind the database constraints. An
email or third-party request needs its own idempotency key or reconciliation
process. The design also adds operational work: outbox rows, retry schedules,
leases, and dead-lettered jobs all need monitoring and retention policies.

There is also a broker boundary. Once an outbox event is marked dispatched,
the application relies on the broker's durability and redelivery settings; it
does not run a separate scanner for new jobs whose message disappears after
that point.

## Practical starting point

For one asynchronous write path, document three boundaries:

1. whether the domain change and publication intent commit atomically;
2. how the consumer behaves when the same logical message runs twice; and
3. how a late worker is prevented from overwriting a newer claim.

Then record which component recovers each crash window and which effects remain
outside the guarantee.
