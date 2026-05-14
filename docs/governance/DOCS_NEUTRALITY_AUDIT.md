# Docs Neutrality Audit

This document defines how upstream protected-surface documentation stays adopter-neutral.

## Protected Surface Checklist

- Product charter files explain ATM using ATM concepts, not one downstream repository.
- Protected docs do not require a private engine, local script, repository path, or task format.
- Examples and templates remain suitable for a clean standalone repository.
- Prompt assets stay model-neutral and host-neutral.
- If host-specific behavior is needed, the protected surface points to an adapter or plugin boundary instead of embedding the downstream detail.

## Banned-Term Scan Scope

The machine-readable policy lives in `docs/governance/docs-neutrality-policy.json`.

- Root protected files: `README.md`, `CONTRIBUTING.md`
- Protected docs: `docs/**/*.md`, excluding `docs/governance/**`
- Protected examples: `examples/**/*.md`
- Protected templates and prompt assets: `templates/**/*.md`

`scripts/validate-product-charter.ts` loads that policy and fails if a protected surface contains a banned downstream-only term.

## Adopter-Only Reference Migration

| Reference type | Upstream action | Migration target |
| --- | --- | --- |
| Downstream repo or product name | Remove from protected surface | Downstream adapter docs or the adopter repository |
| Engine-specific workflow | Replace with neutral contract language | Adapter package or downstream implementation notes |
| Local governance script or repo path | Replace with ATM concept or CLI contract | Plugin docs, adapter docs, or internal runbooks |
| Private task schema or shard layout | Replace with core contract vocabulary | Default Governance Bundle docs or downstream task tooling docs |
| Host-specific UI/game feature example | Replace with neutral example | Example package under a clearly named downstream adapter |

## Self-Hosting Alpha Alignment

The self-hosting alpha gate is only green when the product-charter validator passes this audit. That keeps the official single-entry bootstrap prompt, README, examples, templates, and root-drop guidance free of adopter-only assumptions.