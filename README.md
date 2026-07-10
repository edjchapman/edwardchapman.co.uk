# edwardchapman.co.uk

Personal site of **Ed Chapman** — senior full-stack engineer (Python/Django + FastAPI,
React/TypeScript, AWS/Terraform). Live at [edwardchapman.co.uk](https://edwardchapman.co.uk).

Built with [Astro](https://astro.build), deployed on **Cloudflare Pages** (static output,
no origin server). Layered by design: a 30-second profile card up top, project write-ups
and engineering notes underneath, and — soon — a grounded, eval-gated "ask about my work"
agent.

## Quick start

```bash
npm ci          # install
npm run dev     # dev server
make check      # format check + type check + production build (CI gate)
```

## Workflow

Branch → PR → squash-merge; `main` is protected. CI runs `make check` and validates the
PR title against the commit standard — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE).
