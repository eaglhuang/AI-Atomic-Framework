# Default Governance Bundle Schema

> Status: alpha0 planning note  
> Related schema: `schemas/governance/governance-bundle.schema.json`  
> Related fixture: `tests/schema-fixtures/positive/governance-bundle.json`

## Purpose

The Default Governance Bundle is the upstream reference contract for a repository's governance surface.
It defines the minimum structure required for task tracking, scope locking, document indexing, shard storage,
artifact capture, logs, rule guards, and evidence recording.

The bundle is a reference layout, not a hard dependency of `packages/core`.
Core contracts must remain host-neutral and must not import default plugin implementations directly.

## Alpha0 Boundary

Alpha0 keeps the bundle intentionally small.

Required in v0.1.0:

- `workItem`
- `scopeLock`
- `evidence`
- a canonical `.atm` layout declaration

Planned for later expansion:

- document index store
- shard store
- artifact store
- log store
- run report store
- rule guard outputs
- context summary state

The alpha0 fixture should prove that a repository can record a work item, lock scope, and preserve at least one validation evidence record without relying on any adopter-specific tooling.

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

`evidence` is an array of evidence records. Alpha0 only needs one record to prove the bundle can be validated and replayed.

| Field | Required | Notes |
| --- | --- | --- |
| `evidenceKind` | yes | One of `validation`, `review`, `metric`, `handoff`. |
| `summary` | yes | Human-readable description of what the evidence proves. |
| `artifactPaths` | yes | Artifacts that support the evidence record. |

Alpha0 guidance:

- prefer a validation evidence record
- keep artifact paths relative to the repo
- do not require a full evidence database before the bundle exists

## Reference Fixture

The positive fixture in `tests/schema-fixtures/positive/governance-bundle.json` is the current alpha0 shape.
It demonstrates:

- a fresh bundle with no previous version
- the canonical `.atm` directory layout
- a locked work item
- a lock file pointing at the matching work item
- one validation evidence record

## Design Constraints

- `packages/core` depends on contracts, not default implementations.
- Default governance plugins live behind replaceable packages.
- The bundle must stay host-neutral.
- Adopter-specific tools, private paths, and repo-specific assumptions do not belong in this schema.

## What Comes Next

The next expansion step is to split the bundle into reusable governance surfaces:

1. task card storage
2. document index storage
3. shard storage
4. artifact store
5. log store
6. run report store
7. rule guard outputs
8. context summary state

Those surfaces can then be implemented by default plugins while remaining fully replaceable by a host adapter.
