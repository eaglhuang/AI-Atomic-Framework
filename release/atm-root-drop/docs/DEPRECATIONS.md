# Deprecations Dashboard

Last release audit: pending

This dashboard lists deprecated ATM APIs, commands, schema fields, and release surfaces. It is intentionally conservative: if a deprecation is not listed here, adopters should not be expected to migrate away from it.

## Current Deprecations

| Surface | Tier | Deprecated at | Deprecated in | Removal target | Earliest removal date | Required minor lag | Replacement | Status |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| `tasks reserve` / `tasks promote` | CLI command surface | 2026-06-29 | v0.9.0-alpha.1 | Remove the default AI-facing path after adopters complete `next --claim` migration | 2026-09-29 | 2 | `node atm.mjs next --claim --task <id> --actor <id> --auto-intent --json` | Deprecated by default; only the explicit `--maintainer-override-legacy-lifecycle` escape hatch remains |

## Release Workflow

The release workflow refreshes the `Last release audit` header before publish and asks `scripts/validate-deprecation-policy.ts --mode reminders` whether any row is approaching removal. Future deprecation tasks must add rows here before any release workflow can rely on telemetry or sentinel data for removal timing.

Removal is allowed only when both gates pass: the tier-specific time window has elapsed and the required number of framework minor releases has passed since `Deprecated in`.
