# Security policy

## Supported version

The live deployment at <https://edwardchapman.co.uk> (built from `main`).
Nothing else is supported.

## Reporting a vulnerability

Email <ed@edwardchapman.co.uk> with details and reproduction steps. Please do
not open a public issue for security reports. You should receive a response
within a few days; fixes deploy from `main` via the standard CI gate.

## Scope and context

The site is static-first with one small API surface (`/api/ask`,
`/api/health`). The threat model, trust boundaries, and existing mitigations
are documented in [docs/threat-model.md](docs/threat-model.md); the agent's
safety gates are documented in [docs/evaluation.md](docs/evaluation.md).
Secrets never live in this repository — see the threat model for how
credentials are scoped and rotated.
