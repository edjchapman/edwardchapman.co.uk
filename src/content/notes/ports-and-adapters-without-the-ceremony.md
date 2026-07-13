---
title: "Ports and adapters, without the ceremony"
description: "Hexagonal architecture is two ideas, not a diagram: the domain defines the port, and adapters depend inward. Where the pattern pays for itself — and where it's pure overhead."
pubDate: 2026-07-13
tags:
  - architecture
  - testing
draft: true
relatedProject: foreman
---

Hexagonal architecture has a marketing problem: it's usually presented as a
diagram to memorise, when it's really two load-bearing ideas and a lot of
optional ceremony. The ideas:

1. **The domain defines the port.** The interface belongs to the business
   logic — "I need something that can publish an event" — not to the
   infrastructure that happens to implement it today.
2. **Dependencies point inward.** Adapters (the queue client, the HTTP
   handler, the model provider) import the domain's interface. The domain
   imports nothing of theirs.

Everything else — the hexagon shape, the naming conventions, the
four-layer folder structure — is presentation. Get the dependency direction
right and you have the benefits; get it wrong and no folder layout will
save you.

## What the seam buys you, concretely

The [ask agent on this site](https://edwardchapman.co.uk/ask) has exactly
two ports worth having, and each earns its keep:

- **A `Retriever` interface.** The lexical BM25 implementation sits behind
  it. If golden fixtures ever prove a semantic index retrieves better, it
  swaps in without touching the request pipeline — and the fixtures that
  justified the swap run unchanged against both.
- **A model adapter.** Production binds the real Anthropic client; CI binds
  a deterministic fake that replays canned responses. That one seam is what
  lets the entire API contract — validation, error mapping, timeout
  handling, citation whitelisting — run as required checks on every pull
  request, keyless and flake-free.

[Foreman](https://edwardchapman.co.uk/projects/foreman) makes the same move
at the broker boundary: retry state lives in PostgreSQL rather than inside
the message broker, precisely so the interesting behaviour (claiming,
retries, dead-lettering) is queryable, testable, and not coupled to one
vendor's redelivery semantics.

In both cases the test seam is the real product of the pattern. "Swap the
database someday" is a hypothetical; "test the domain without the
infrastructure today" is a daily dividend.

## When not to bother

A port with one implementation, no test that uses a fake, and no plausible
second binding is speculative abstraction — an interface tax paid on every
read of the code. I don't wrap the framework's router, the standard
library, or anything I'd never stub in a test. The honest heuristic: create
the seam when the second implementation exists or the test needs it,
whichever comes first. On this site that produced exactly two ports, not
twenty.

The other failure mode is defining the port in infrastructure vocabulary —
`KafkaPublisher` with topic names in the signature — then claiming
hexagonality. If the interface leaks the adapter's dialect, the dependency
arrow still points outward; you've drawn the hexagon and kept the coupling.

## Honest limitations

Ports and adapters says nothing about the hard part of most systems: what
the domain logic should _be_. It also adds real indirection — every seam is
one more hop a reader traverses. On small codebases the pattern's full
regalia costs more comprehension than it saves; the two-idea core (domain
owns the interface, dependencies point in) is the part that scales down
gracefully.

## Where to start

Find the one dependency your tests keep fighting — the paid API, the
broker, the clock. Define the narrowest interface your domain actually
needs from it, in your domain's vocabulary. Write the fake, move the tests
onto it, and stop. That single seam teaches you more about the pattern than
any diagram will.
