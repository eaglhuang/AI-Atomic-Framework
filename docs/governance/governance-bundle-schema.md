# Default Governance Bundle Schema

> Status: alpha0 contract with optional store expansion points  
> Related schema: `schemas/governance/governance-bundle.schema.json`  
> Related fixtures: `tests/schema-fixtures/positive/governance-bundle.json`, `tests/schema-fixtures/positive/governance-bundle-full.json`

## Purpose

The Default Governance Bundle is the upstream reference contract for a repository's governance surface.
It defines the minimum structure required for task tracking, scope locking, document indexing, shard storage,
artifact capture, logs, rule guards, and evidence recording.

The bundle is a reference layout, not a hard dependency of `packages/core`.
Core contracts must remain host-neutral and must not import default plugin implementations directly.

## Alpha0 Boundary

Alpha0 keeps the required bundle intentionally small, but ATM-2-0009 adds optional reusable store contracts so downstream adapters can serialize a fuller governance surface without inventing their own schema family.

Required in v0.1.0:

- `workItem`
- `scopeLock`
- `evidence`
- a canonical `.atm` layout declaration

Optional expansion points now available in the same bundle version:

- `artifactStore`
- `logStore`
- `runReportStore`
- `stateStore`
- `evidenceStore`
- `contextSummary`
- `adapterReports`

The alpha0 fixture proves the minimum viable contract. The expanded fixture proves the same bundle version can also carry replayable artifact, log, report, state, evidence, handoff, and adapter surfaces when a host needs them.

## Bundle Shape

The current schema root is:

- `schemaId`: `atm.governanceBundle`
- `specVersion`: `0.1.0`

Top-level properties:

| Field | Required | Purpose |
| --- | --- | --- |
| `schemaId` | yes | Identifies the bundle family. |
| `specVersion` | yes | Tracks the bundle schema version. |
| `migration` | yes | Declares whether the bundle is new, additive, or breaking relative to a prior version. |
| `layout` | yes | Declares the canonical `.atm` directory contract. |
| `workItem` | yes | Stores the upstream work item metadata. |
| `scopeLock` | yes | Stores the active scope lock for the work item. |
| `evidence` | yes | Stores at least one evidence record. |
| `artifactStore` | no | Stores replayable artifact records. |
| `logStore` | no | Stores structured log batches. |
| `runReportStore` | no | Stores validation or orchestration reports. |
| `stateStore` | no | Stores markdown/json state snapshots. |
| `evidenceStore` | no | Stores typed evidence records with reproducibility metadata. |
| `contextSummary` | no | Stores a handoff-ready summary for the work item. |
| `adapterReports` | no | Stores adapter-specific execution or parity reports. |

## Migration

`migration` is explicit so that future bundle versions can be evolved without guessing.

| Field | Type | Notes |
| --- | --- | --- |
| `strategy` | `none` / `additive` / `breaking` | Describes how the current bundle relates to a previous version. |
| `fromVersion` | string \| null | Semantic version string for the source bundle, or `null` for a fresh bundle. |
| `notes` | string | Human-readable migration note. |

For alpha0, the fixture uses `strategy: "none"` and `fromVersion: null`.

## Layout Contract

The bundle declares a fixed `.atm` root and the default store paths used by governance tooling.

Required layout paths:

| Path field | Canonical value | Purpose |
| --- | --- | --- |
| `root` | `.atm` | Governance root folder. |
| `taskStorePath` | `.atm/tasks` | Task cards and task manifests. |
| `lockStorePath` | `.atm/locks` | Scope lock records. |
| `documentIndexPath` | `.atm/index` | Document index projections. |
| `shardStorePath` | `.atm/shards` | Large document shard projections. |
| `stateStorePath` | `.atm/state` | Markdown and JSON state files. |
| `artifactStorePath` | `.atm/artifacts` | Generated outputs and artifacts. |
| `logStorePath` | `.atm/logs` | System and run logs. |
| `runReportStorePath` | `.atm/reports` | Validation and run reports. |
| `ruleGuardPath` | `.atm/rules` | Rule guard outputs. |
| `evidenceStorePath` | `.atm/evidence` | Evidence records. |

Reserved layout hints already allowed by the schema:

- `registryStorePath` -> `.atm/registry`
- `contextSummaryStorePath` -> `.atm/state/context-summary`

These are useful for later phases but are not part of the required layout set in alpha0.

## WorkItem Contract

`workItem` is the canonical task metadata node.

| Field | Required | Notes |
| --- | --- | --- |
| `workItemId` | yes | Must match `^ATM-[A-Z][A-Z0-9]*-\d{4}$`. |
| `title` | yes | Short human-readable title. |
| `status` | yes | One of `planned`, `locked`, `running`, `verified`, `done`, `blocked`. |
| `owner` | no | Optional owner or agent name. |
| `externalRef` | no | Optional host tracker reference. |

`externalRef` can point to upstream systems such as Jira, GitHub Issues, Linear, Notion, or a custom tracker, but it must remain optional.

## ScopeLock Contract

`scopeLock` records which files are currently under the work item's control.

| Field | Required | Notes |
| --- | --- | --- |
| `workItemId` | yes | Must match the parent work item. |
| `lockedBy` | yes | Agent or user that acquired the lock. |
| `lockedAt` | yes | ISO date-time string. |
| `files` | yes | Unique list of files under lock. |

The lock record is intentionally minimal. It should answer only one question: what files are reserved for this work item right now?

## Evidence Contract

`evidence` is an array of lightweight evidence records. Alpha0 only needs one record to prove the bundle can be validated and replayed.

| Field | Required | Notes |
| --- | --- | --- |
| `evidenceKind` | yes | One of `validation`, `review`, `metric`, `handoff`. |
| `summary` | yes | Human-readable description of what the evidence proves. |
| `artifactPaths` | yes | Artifacts that support the evidence record. |

Alpha0 guidance:

- prefer a validation evidence record
- keep artifact paths relative to the repo
- do not require a full evidence database before the bundle exists

When a host needs stronger replay or comparison semantics, use the optional `evidenceStore` with the standalone contracts in `schemas/governance/evidence.schema.json` and `schemas/governance/evidence/*.schema.json`.

Available typed evidence payloads:

- `usage-feedback`
- `quality-baseline`
- `quality-comparison`
- `rollback-proof`

## Reference Fixture

The positive fixture in `tests/schema-fixtures/positive/governance-bundle.json` is the current alpha0-minimal shape.
It demonstrates:

- a fresh bundle with no previous version
- the canonical `.atm` directory layout
- a locked work item
- a lock file pointing at the matching work item
- one validation evidence record

The expanded fixture in `tests/schema-fixtures/positive/governance-bundle-full.json` demonstrates the optional store contracts on top of the same bundle version:

- replayable artifact entries
- structured logs
- run reports
- markdown/json state snapshots
- typed evidence with reproducibility metadata
- a context summary handoff node
- adapter-specific reports

## Design Constraints

- `packages/core` depends on contracts, not default implementations.
- Default governance plugins live behind replaceable packages.
- The bundle must stay host-neutral.
- Adopter-specific tools, private paths, and repo-specific assumptions do not belong in this schema.

## Downstream Mapping

The bundle schema stays host-neutral, but downstream repositories do not need to mirror `.atm/*` literally.
See `docs/governance/3klife-governance-mapping.md` for one example of how an adopter can map these store contracts onto an existing docs-first workflow without changing the upstream schema.

## What Comes Next

The next step is no longer schema invention. It is implementation parity:

1. serialize these reusable governance surfaces from default plugins
2. let host adapters decide which optional stores they persist
3. keep replay and evidence generation consistent across adapters
4. preserve the same contracts even when the physical storage paths differ downstream
