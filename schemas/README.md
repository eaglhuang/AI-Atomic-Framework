# Schema Policy

The `schemas/` directory contains language-neutral contracts for alpha0 ATM data. These files are schema-first seeds. They define the shape of portable records before loaders, managers, CLI commands, or runtime runners are implemented.

## Version Fields

Every alpha0 schema reserves the same metadata fields:

- `schemaId`: a stable identifier for the record family.
- `specVersion`: the contract version used by the record.
- `migration`: the compatibility and migration policy for this record shape.

The first seed version is `0.1.0`. Later additive schema changes should keep the existing `schemaId` stable and update `specVersion`. Breaking changes must be recorded through the `migration` object.

## Alpha0 Boundary

Alpha0 schemas define contracts only. They do not implement parsing, registry management, hash calculation, CLI validation, or regression execution. Those capabilities belong behind later package, plugin, or adapter boundaries.

## Reserved Performance Budget

`AtomicSpec` reserves an optional `performanceBudget` object with `hotPath` and `inputMutation` fields. Alpha0 does not require measurement, but the shape is reserved now so alpha1 can add budget checks without a breaking schema change.

## Governance Seeds

`schemas/governance/` holds the default governance bundle contracts:

- `work-item.schema.json` for the minimal work item record;
- `scope-lock.schema.json` for the minimal scope lock record;
- `artifact.schema.json`, `log.schema.json`, `run-report.schema.json`, and `markdown-json-state.schema.json` for replayable governance store surfaces;
- `evidence.schema.json` plus `schemas/governance/evidence/*.schema.json` for typed evidence payloads;
- `context-summary.schema.json` and `adapter-report.schema.json` for handoff and adapter-facing reports;
- `governance-bundle.schema.json` for the reference `.atm` layout plus an alpha0-minimal bundle and optional store expansion points.

These files are host-neutral seeds. They define the default contract shape before any Jira, GitHub Issues, filesystem adapter, or downstream repo mapping is introduced.