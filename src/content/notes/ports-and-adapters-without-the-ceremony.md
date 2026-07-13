---
title: "Ports and adapters: dependency direction and test seams"
description: "A practical account of ports and adapters: where interfaces belong, how dependencies point inward, what the pattern enables in tests, and when the indirection is unnecessary."
pubDate: 2026-07-13
tags:
  - architecture
  - testing
draft: false
relatedProject: foreman
---

The ports-and-adapters pattern, also called hexagonal architecture, separates
application logic from external systems. The original
[description by Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)
frames the application as an inside that communicates through ports, with
adapters connecting those ports to databases, message brokers, user
interfaces, and tests.

Two dependency rules carry most of the value:

1. **The application owns the port.** The interface describes what the
   application needs in its own vocabulary, such as retrieving evidence or
   publishing an event.
2. **Adapters depend inward.** Infrastructure implements or calls those
   application-facing interfaces. The application does not depend on a
   provider SDK or transport-specific type.

The names of folders and layers are secondary to those dependency directions.

## What the seam provides

The [ask agent on this site](https://edwardchapman.co.uk/ask) contains two
useful examples:

- **`Retriever`** defines the search operation used by the agent. The current
  service constructs the lexical implementation directly, so this is a
  documented replacement boundary rather than fully injected dependency. A
  future semantic retriever would require wiring at service construction and
  should run against the same golden retrieval cases.
- **`ModelAdapter`** is injected into the agent service. Production supplies
  the Anthropic adapter; tests supply deterministic behaviours for successful
  answers, malformed responses, timeouts, rate limits, and invalid citations.

Both interfaces and their implementations are visible in the public
[agent source](https://github.com/edjchapman/edwardchapman.co.uk/tree/main/src/lib/agent).
The model port is the stronger example because the service receives it from
outside rather than constructing a provider itself.

[Foreman](https://edwardchapman.co.uk/projects/foreman) demonstrates a related
boundary at the message broker. Retry and lease state is stored in PostgreSQL
rather than delegated to Celery's retry mechanism. This is not itself a formal
port, but it keeps the recovery rules queryable and testable without relying
on one broker's internal redelivery state.

## Criteria for adding a port

A port is usually justified when at least one of these conditions applies:

- tests need a deterministic substitute for a slow, paid, or unreliable
  dependency;
- more than one implementation already exists;
- a provider or transport is expected to change independently of the
  application; or
- the external API exposes more behaviour than the application should depend
  on.

The port should be narrower than the provider SDK. For example, an application
interface might accept an event and return a publication result; topic names,
client configuration, and broker-specific exceptions remain in the adapter.

## When a direct dependency is clearer

An interface adds a name, a file, and another step for a reader to follow. If
there is one stable implementation, no useful test substitute, and no boundary
to protect, direct use may be clearer.

Framework routers and standard-library functions are common examples. Wrapping
them without an application-specific requirement often reproduces the original
API without reducing coupling.

## Limitations

Ports and adapters controls dependency direction; it does not determine the
domain model or make the business rules correct. It can also hide useful
provider capabilities if the port is made too generic.

On a small codebase, the full set of layers associated with hexagonal
architecture may cost more comprehension than it saves. The useful minimum is
an application-owned interface at a boundary where testing or replacement has
a demonstrated benefit.

## Practical starting point

Choose one external dependency that makes a test slow or non-deterministic.
List only the operations the application needs, define those operations in
application terms, and implement both the production adapter and a deterministic
test adapter. Keep the rest of the code direct until another boundary has the
same evidence.
