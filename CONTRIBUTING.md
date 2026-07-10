# Contributing

Solo-maintained personal site, but the workflow is real:

1. Branch from `main` (never commit to `main` directly — it's protected).
2. Make the change; run `make check` (format + type check + build).
3. Open a PR — the title becomes the squash-merge commit subject, so follow
   the commit standard: `<type>[(<scope>)][!]: <subject>` with types
   `feat | fix | content | docs | ci | build | chore | revert`.
4. CI must pass (`make check` + `validate PR title`); squash-merge only.
