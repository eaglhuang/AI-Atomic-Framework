# Deprecations Dashboard

Last release audit: pending

This dashboard lists deprecated ATM APIs, commands, schema fields, and release surfaces. It is intentionally conservative: if a deprecation is not listed here, adopters should not be expected to migrate away from it.

## Current Deprecations

| Surface | Tier | Deprecated at | Deprecated in | Removal target | Earliest removal date | Required minor lag | Replacement | Status |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| None | n/a | n/a | n/a | n/a | n/a | 0 | n/a | active baseline |

## Release Workflow

The release workflow refreshes the `Last release audit` header before publish and asks `scripts/validate-deprecation-policy.ts --mode reminders` whether any row is approaching removal. Future deprecation tasks must add rows here before any release workflow can rely on telemetry or sentinel data for removal timing.

Removal is allowed only when both gates pass: the tier-specific time window has elapsed and the required number of framework minor releases has passed since `Deprecated in`.
