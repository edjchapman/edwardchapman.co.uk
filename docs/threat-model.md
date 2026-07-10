# Threat model

<!-- Skeleton — completed in Phase 3. -->

## Assets

- Anthropic API key (Worker secret), Cloudflare deploy token (Actions secret)
- Public-content boundary (nothing private may be published or bundled)
- Site availability and cost budget

## Trust boundaries

- Public repo ↔ private material (defended by content-policy gate)
- Build time ↔ request time (corpus is built, never fetched)
- Static assets ↔ Worker execution (assets never invoke the Worker)
- User input ↔ model prompt (Phase 3: validation, retrieval, whitelisting)

## Threats and mitigations

To be completed alongside the agent foundation (Phase 3): secret leakage,
prompt injection, unsupported claims, private-content inclusion, build
artefact leakage, cost abuse, request flooding, oversized payloads, malicious
model output, log injection, dependency/supply-chain compromise,
deployment-token compromise, preview-environment exposure.
