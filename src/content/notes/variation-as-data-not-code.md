---
title: "Modelling product variation as data"
description: "When schema-validated configuration is a better model than branches or subclasses, with practical guidance on validation, versioning, migration, and operational risk."
pubDate: 2026-07-13
tags:
  - architecture
  - backend
draft: false
---

Products often accumulate related variants: plans, tenant settings, regional
rules, workflows, or form definitions. Implementing every difference as a
branch or subclass can make the supported combinations difficult to inspect
and can require a deployment for a data-only change.

One option is to represent stable variation as data: each variant is a
declarative document, validated against a schema and interpreted by shared
code. This is appropriate only when the differences fit a bounded model.

## Suitable forms of variation

Configuration works well when variants differ through parameters and
composition, for example:

- which fields are enabled;
- threshold values within defined ranges;
- which existing steps run and in what order; or
- which existing policy options apply.

A change belongs in code when it introduces new behaviour that the interpreter
does not understand. Adding conditionals, loops, or general expressions to
configuration gradually creates a programming language, along with the need
for debugging, security controls, and execution semantics.

Useful design questions are:

1. Can the variation be expressed with a finite, documented schema?
2. Can invalid combinations be rejected before activation?
3. Do all variants use the same interpreter semantics?
4. Is the authoring and review process appropriate for the risk of the change?

Configuration can still require engineering review. The distinction is about
the form of the variation, not the job title of the person editing it.

## Validation, versioning, and migration

The schema is only the starting point. The lifecycle needs three explicit
decisions:

1. **Validation.** Validate at the authoring or loading boundary, before a
   configuration becomes active. Errors should identify the field and violated
   constraint. This site applies the same principle to content: typed schemas
   reject invalid frontmatter during the build rather than serving a partially
   valid page.
2. **Versioning.** Decide whether a running entity reads the latest
   configuration, records a version, or stores a snapshot. The choice depends
   on whether existing behaviour should change when the configuration changes.
3. **Migration.** When the schema changes, either migrate stored documents or
   keep readers for older versions. The supported versions and retirement path
   should be explicit.

The interpreter becomes shared critical-path code. Tests should cover each
schema feature, invalid combinations, version transitions, and representative
complete documents.

## Limitations

The break-even point depends on the complexity, change rate, and operational
risk of the variants; it cannot be determined from a fixed number of variants.
For a small and stable set, direct code may remain easier to read and change.

Configuration also centralises risk. A defect in a variant-specific branch may
affect one path, while a defect in the shared interpreter can affect every
variant. Validation, staged rollout, audit history, and rollback become more
important as configuration controls more behaviour.

## Practical starting point

Choose two existing variants and describe only the differences already present
in the code. Define a schema for those differences, validate the documents in
CI, and route the two variants through the shared interpreter. Compare the new
representation with the original code before migrating further variants.

This incremental approach tests whether the schema reflects real variation and
keeps new interpreter behaviour tied to an existing example.
