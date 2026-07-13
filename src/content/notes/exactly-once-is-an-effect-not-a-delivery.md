---
title: "Exactly-once is an effect, not a delivery"
description: "No broker delivers exactly once. Systems that behave exactly-once engineer it at the edges: atomic intent capture, idempotent effects, and fencing against the worker that wasn't dead."
pubDate: 2026-07-13
tags:
  - backend
  - reliability
  - distributed-systems
draft: true
relatedProject: foreman
---

"Does the queue guarantee exactly-once?" is the wrong question, and
interviews and design reviews alike keep asking it. Delivery is a property
of a lossy network conversation: the message can always arrive twice, or
arrive while the acknowledgement dies. What a system can engineer is
**exactly-once effect** — duplicates may flow, but state changes as if each
logical operation happened once. That property lives at the edges you
control, not in the broker.

[Foreman](https://edwardchapman.co.uk/projects/foreman) is my working
demonstration of the full chain — a deliberately small pipeline with
deliberately large guarantees, every decision recorded as an ADR in the
public repo. The chain has three links.

## Capture intent atomically: the outbox

The classic lost-work bug is committing to the database and _then_
publishing to the queue — two systems, no shared transaction, and a crash
between them silently drops the event. The transactional outbox closes the
gap: the domain row and an outbox event commit in **one** database
transaction, and a relay publishes pending events afterwards. Multiple
relays claim disjoint batches with `SELECT … FOR UPDATE SKIP LOCKED`, so
scaling the relay tier doesn't create duplicate publishers.

The cost is honest: the relay retries, so downstream now sees
**at-least-once**. The outbox doesn't eliminate duplicates — it converts
"maybe never" into "maybe twice", which is the only trade in stock.

## Absorb duplicates: idempotent effects

"Maybe twice" is fine when the second time is a no-op. Foreman's workers
get there with two mechanisms, belt and braces: a **state guard** (only
process a job in the expected state) and a **natural-key constraint** (the
database physically refuses a second insert of the same logical work). The
constraint is the one that holds under true concurrency — two workers can
both pass a state check, but only one wins the unique index.

Failure handling is classified, not generic: poison input fails fast to a
redrivable dead-letter queue; transient failures retry with capped
full-jitter backoff. Retry state lives in PostgreSQL rather than the
broker, so "what's stuck and why" is a query, not an archaeology session —
and it survives broker restarts.

## Fence the survivor: leases and tokens

The subtlest duplicate isn't a redelivery — it's a worker that was slow,
not dead. Its lease expires, a reaper hands the job to a new claimant, and
then the original wakes up and writes. Foreman stamps each claim with a
fresh **fencing token**; a late write carrying a stale token is rejected.
Without fencing, every timeout-based recovery mechanism is a race with a
ghost.

One residual window stays open, documented rather than hidden: a crash in
the instant after dispatch is recovered only by broker-level late
acknowledgement. Reliability work is like that — the honest version names
the window it couldn't close.

## Honest limitations

This chain costs a database that participates in every hop, and it leans on
PostgreSQL's locking and unique constraints; at some throughput the outbox
table becomes the thing you're operating. And "exactly-once effect" is
scoped to effects the constraint can see — side effects outside the
database (an email, a third-party call) need their own idempotency story,
usually a provider-side key.

## Where to start

Trace one write path in your system and ask three questions: is intent
captured in the same transaction as the state change; what happens if this
consumer runs twice; and what happens if a presumed-dead worker writes
late. The first question finds your lost work, the second your duplicates,
the third your rarest and worst incident. Fix them in that order.
