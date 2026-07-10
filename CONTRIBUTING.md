# Contributing

Single-maintainer repository, but the workflow is deliberately the same as a
team repo — the process is part of what this project demonstrates.

## Workflow

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…` — any short slug).
2. Make focused commits. Branch commits are disposable WIP; they are squashed
   away on merge.
3. Run `make check` locally before pushing — it is exactly what CI runs.
4. Open a PR. The **PR title becomes the permanent commit subject on `main`**
   (squash-merge), so it must follow the commit standard below.
5. Merge only when the required checks (`make check`, `validate PR title`)
   are green. `main` is protected: no direct pushes, linear history,
   squash-only.

## Commit standard

Conventional Commits, validated strictly by `scripts/check-commit-msg.sh`:

```text
<type>[(<scope>)][!]: <subject>
```

Allowed types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build`
`ci` `chore` `revert`. Scope is an optional lowercase slug; `!` marks a
breaking change.

## Quality gate

`make check` aggregates: markdown link/anchor checks, format check, lint,
`astro check` (types), unit tests, production build, content-policy scan, and
built-output link validation. `make help` lists every target.

## Hooks

This repo does **not** set `core.hooksPath` — commits run through the global
git-hooks dispatcher (secret scanning via ggshield), and
`.pre-commit-config.yaml` adds `make check` as a local pre-commit hook. The
vendored `.githooks/` directory exists for contributors who prefer wiring it
directly (`git config core.hooksPath .githooks`).

## Content boundary

Everything published here must satisfy [docs/content-policy.md](docs/content-policy.md).
Never source material from private repositories, documents, or conversations.
