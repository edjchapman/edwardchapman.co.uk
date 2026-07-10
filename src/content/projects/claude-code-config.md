---
title: "claude-code-config"
problem: "AI coding agents drift without shared standards — every repository and machine ends up with different rules, permissions, and workflows."
built: "A single source of truth for Claude Code: fourteen specialist agents, eighteen skills, composable permission and MCP templates, lifecycle hooks, and setup scripts that vendor consistent tooling into any project."
differentiator: "Composable by design — stack templates merge (Django + React in one command) into a deny-aware permission set, and symlinked config propagates updates to every project and machine at once, validated by CI on each push."
tech:
  - Shell
  - Claude Code
  - GitHub Actions
featured: true
order: 3
draft: false
repo: "https://github.com/edjchapman/claude-code-config"
---

## Context

Working with AI coding agents daily surfaces a real operations problem:
configuration sprawl. Agents, skills, permission rules, MCP servers, hooks,
and commit standards accumulate per-project and per-machine, drift apart, and
silently disagree. This repository is the fix — one canonical, versioned
source that every project and machine consumes.

## Problem

Make agent behaviour consistent and reviewable across many repositories and
machines: the same specialist agents and skills everywhere, permission
policies that compose per stack rather than being hand-edited per repo, and a
way for improvements to propagate without a per-project chore.

## Constraints

- Zero-dependency installation: plain shell, no runtime to bootstrap.
- Two consumption modes had to coexist — the Claude Code plugin marketplace
  and legacy symlinked global config — resolving paths correctly in both.
- Personal layers (local settings, MCP credentials) must stay out of consumer
  repositories while shared layers are committed.

## Architecture

A content-addressed layout of agents, skills, rules, hooks, and templates,
consumed three ways: `setup-global.sh` symlinks the shared layers into
`~/.claude/`; `setup-project.sh <stack>` merges stack templates into a
project's local settings and MCP config; `install-tooling.sh` vendors the
hard-tooling layer (Makefile gate, CI workflows, commit-style validation,
git hooks) into a repository. Hook resolution uses
`${CLAUDE_PLUGIN_DIR:-<readlink fallback>}` so the same hooks work as a
plugin or as symlinked config.

## Important engineering decisions

- **Composition over configuration copies.** Permission templates merge —
  `django react` composes both stacks' allow/deny rules into one deny-aware
  set — so a project's policy is derived, not forked.
- **Symlinks as the propagation mechanism.** Updating the canonical repo
  updates every consuming machine and project immediately; there is no
  "update all my repos" chore to forget.
- **The tooling layer is vendored, not linked.** CI workflows, Makefile, and
  validators are copied into consumer repos (copy-if-absent, idempotent) so
  each repository remains self-contained and auditable.
- **Config is CI-validated.** A validation workflow checks structure and
  templates on every push — configuration is treated as code because it is.

## Alternatives considered

Per-repo hand-maintained `.claude/` directories (the drift this replaces); a
dotfiles-manager-only approach (handles machines, not project-level
composition); publishing solely as a plugin (would strand pre-plugin
installs — both modes are supported instead).

## Testing and quality approach

CI validation on every push over the config structure and templates; the
vendored tooling layer carries its own gate (`make check` with link/anchor
validation and strict conventional-commit checks) into every consumer repo —
including the one serving this site.

## Operational or deployment model

There is no runtime: distribution is git. Machines consume via symlinks or
the plugin marketplace; projects via the setup scripts. Updates ship by
committing to the canonical repo.

## Outcome

Every project (this site included) gets the same agents, skills, permission
policies, quality gates, and commit standards from one reviewed source —
with 8 GitHub stars from other people running the same setup.

## Current limitations

- Permission-template composition is shallow merge with deny-precedence; it
  doesn't detect semantically conflicting allow rules.
- The vendored tooling layer updates by re-running the installer
  (copy-if-absent), so consumer repos don't automatically track upstream
  improvements.
- Documentation assumes familiarity with Claude Code's configuration model.

## What I'd do next

A drift-detection command that diffs a consumer repo's vendored layer against
upstream; template linting that flags conflicting permission rules at compose
time; richer per-stack MCP templates.

## Relevant links

- [Repository](https://github.com/edjchapman/claude-code-config)
