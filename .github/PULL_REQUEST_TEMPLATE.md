## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `make check` passes locally (format, lint, types, tests, build,
      content policy, internal links)
- [ ] PR title follows the conventional-commit style — it becomes the
      squash-commit subject on `main` (see CONTRIBUTING.md)
- [ ] No private material: nothing sourced from non-public repositories,
      documents, or conversations (see docs/content-policy.md)

## Accessibility (required when the PR changes UI)

Manual checks — automated scans are necessary but not sufficient:

- [ ] Every interactive element reachable and operable by keyboard alone
- [ ] Focus visibly indicated at all times; no focus traps
- [ ] Heading levels are hierarchical (no skipped levels)
- [ ] Text contrast ≥ 4.5:1 against its background
- [ ] Meaning never conveyed by colour alone
- [ ] `prefers-reduced-motion` respected by any animation/transition
- [ ] Page remains readable and navigable with JavaScript disabled
