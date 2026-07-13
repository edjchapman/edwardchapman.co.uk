---
title: "Variation as data, not code"
description: "When the tenth similar-but-different variant lands, the senior move is a schema-driven config engine — and the hard parts are validation, versioning, and migration, not the config table."
pubDate: 2026-07-13
tags:
  - architecture
  - backend
draft: true
---

Every product that survives contact with customers grows variants: another
plan, another tenant, another regional rule, another form type. The first
few arrive as `if` statements. Around the fifth, someone extracts a
strategy class. Around the tenth, the codebase has a shadow config system —
constants, feature flags, and subclass overrides that only three people can
safely change — and every new variant is a deploy.

The structural fix is to promote the variation to **data**: a declarative
description of each variant, validated against a schema, interpreted by one
engine. Adding the next variant becomes authoring a document, not shipping
code.

## When data beats code

The signal is shape, not size. Config-as-data wins when variants differ in
_parameters and composition_ — which fields, which thresholds, which steps
in which order — and lose when they differ in _algorithm_. A pricing rule
that reorders and reweights known factors is data. A pricing rule that
needs a new factor nobody modelled is code, and forcing it through the
config engine turns your schema into a Turing tarpit. The moment config
grows conditionals and loops, you've built a worse programming language
with no debugger.

A useful test: could a careful non-engineer author the next variant from
documentation alone? If yes, it's configuration. If it needs a design
review, it's code wearing a costume.

## The three hard parts

Describing the config table is the easy 20%. The engineering lives in the
lifecycle:

1. **Validation.** The schema is a contract, so enforce it like one — at
   authoring time, not at interpretation time. A typo in a variant
   definition should fail fast and name the field, in the tool where the
   variant was authored. Runtime is too late; a customer found it first.
   (This site runs the same discipline in miniature: typed content schemas
   reject an invalid frontmatter field at build, never in production.)
2. **Versioning.** Variants evolve, and running systems reference the
   version they were created under. Decide explicitly whether an in-flight
   entity re-reads current config or carries a snapshot — either is
   defensible, but drifting between the two silently is how you get
   irreproducible bugs.
3. **Migration.** The schema itself will change. Every schema change needs
   a story for existing variant documents: migrate them forward, or support
   reading old versions indefinitely. Skipping this decision doesn't defer
   it; it just moves it into an incident.

Name the trade-off out loud when you propose the design: the engine's
interpreter is now critical-path code, and its test suite needs a fixture
per schema feature — because every author of every future variant is
trusting the interpreter to mean what the schema says.

## Honest limitations

A config engine is an investment with a break-even point measured in
variants. Below perhaps half a dozen, the `if` statements are honestly
cheaper, and cheaper to delete. And the engine centralises risk: a bug in
one strategy class breaks one variant; a bug in the interpreter breaks all
of them at once. The test discipline has to match that blast radius.

## Where to start

Don't build the engine speculatively. When the pain is real: pick two
existing variants, write the schema that describes only the ways they
already differ, validate it in CI, and route just those two through the
interpreter. The third variant migrates in a follow-up. Schemas grown from
real variance stay honest; schemas designed in advance grow features
nobody's variant ever uses.
