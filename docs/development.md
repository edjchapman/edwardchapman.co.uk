# Development

## Prerequisites

- **Node.js 24 LTS** (ships corepack, which manages pnpm via the
  `packageManager` field — no global pnpm install needed)
- **git**, **make**, **python3** (markdown anchor checker)
- Optional: **gh** (GitHub CLI) for the PR workflow

## Setup

```sh
git clone https://github.com/edjchapman/edwardchapman.co.uk.git
cd edwardchapman.co.uk
make setup    # corepack enable pnpm + pnpm install --frozen-lockfile
make check    # the full gate — green on a fresh clone
```

## Everyday commands

| Command                         | What it does                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `make dev`                      | Astro dev server (hot reload) at `localhost:4321`                                                            |
| `make preview`                  | Production build served through `wrangler dev` (real asset/Worker semantics)                                 |
| `make check`                    | The whole gate: md links/anchors, format, lint, `astro check`, unit tests, build, content policy, dist links |
| `make test-e2e`                 | Playwright suite against the built site (first run: `pnpm exec playwright install chromium`)                 |
| `make check-perf`               | Lighthouse budgets against the built site (optional — not in `make check`; CI runs it per PR via `perf.yml`) |
| `make format` / `make lint-fix` | Write-mode formatting / autofixable lint                                                                     |
| `make help`                     | Everything else                                                                                              |

`make check` is exactly what CI runs — if it's green locally, the required
checks will be green.

## Working conventions

Branch → PR → squash-merge; the PR title becomes the permanent commit subject
and is validated strictly (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
Commits run through the global git-hooks dispatcher: secret scan plus
`make check` via `.pre-commit-config.yaml`.

## Content authoring

Add or edit entries under `src/content/{projects,notes,profile}/`. Schemas in
[`src/lib/schemas.ts`](../src/lib/schemas.ts) validate frontmatter at build
time — a bad entry is a red build, not a broken page. Set `draft: true` to
keep an entry out of production (and out of the Phase-3 agent corpus). Before
writing, read [docs/content-policy.md](content-policy.md); the policy scanner
will hold you to it.

**Internal cross-links inside content markdown use canonical absolute URLs**
(`https://edwardchapman.co.uk/...`), not root-relative paths — the markdown
link checker validates repo-file links, and the Phase-3 corpus needs
canonical citation URLs anyway. The built-output checker still validates
them against dist.

**Social cards are generated, never hand-edited**: `make build` runs
`scripts/build-og-cards.ts`, which renders `public/og/{projects,notes}/*.png`
from non-draft frontmatter and the site-wide fallback `public/og/default.png`
from the positioning tagline. The whole `public/og/` directory is gitignored
— see docs/architecture.md § Build pipeline.

**`public/llms.txt` is maintained by hand**: when pages or featured projects
change, update it in the same PR (it is a discovery aid, not a security
boundary — see docs/spec.md §9). The Phase-3 corpus builder is the natural
point to start generating it instead; until then, hand-maintenance is the
documented process.

## Troubleshooting

- **`astro check` fails inside the Cloudflare plugin** — the adapter reads
  `wrangler.jsonc`; ensure you haven't added a `main` (the adapter injects
  its own entrypoint) or removed the `assets` binding.
- **pnpm refuses to run postinstall scripts** — build allowances live in
  `pnpm-workspace.yaml` (`allowBuilds`); esbuild/sharp/workerd must stay
  allowed.
- **TypeScript 7** — pinned to 5.9 until typescript-eslint supports TS7
  (dependabot is configured to skip that major).
