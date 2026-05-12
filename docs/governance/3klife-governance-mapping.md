# 3KLife Governance Mapping Note

This note documents one downstream mapping strategy for the default ATM governance contracts.
It is an adopter example, not part of the upstream schema contract.

## Goal

3KLife already has a docs-first workflow, task lock tooling, generated artifacts, and registry shards.
That repo does not need to create a literal `.atm/` tree to benefit from the upstream governance schemas.
Instead, an adapter can map the logical stores onto the existing surfaces.

## Suggested Mapping

| Governance surface | Default `.atm` contract | 3KLife mapping candidate |
| --- | --- | --- |
| work item store | `.atm/history/tasks` | `docs/agent-briefs/tasks/*.md` |
| scope lock store | `.atm/runtime/locks` | `tools_node/task-lock.js` managed lock records |
| document index | `.atm/index` | `docs/doc-id-registry-shards/*` |
| shard store | `.atm/shards` | `docs/tasks/*.json` shards and doc-id registry shards |
| artifact store | `.atm/history/artifacts` | `artifacts/` |
| log store | `.atm/history/logs` | generated run logs under `artifacts/` or other repo-approved log sinks |
| run report store | `.atm/history/reports` | validation and workflow reports under `artifacts/` |
| state store | `.atm/runtime/state` | markdown/json state files already tracked under `docs/` or `artifacts/` |
| evidence store | `.atm/history/evidence` | evidence JSON stored beside reports or other generated artifacts |
| context summary store | `.atm/history/handoff` | generated handoff summaries or task-level context summaries |
| adapter reports | optional | adapter-specific JSON reports under `artifacts/` |

## Important Constraint

The mapping layer should preserve the upstream record shapes even when the physical folders differ.
That means a 3KLife adapter can write `atm.governanceBundle`, `atm.evidence.*`, or `atm.contextSummary` documents into repo-specific paths without forking the schema family.

## Practical Rules

- Treat the upstream schema as the portable contract and the downstream path as an adapter concern.
- Reuse existing 3KLife task cards and lock tooling instead of duplicating them into a second tracker.
- Keep artifact and evidence paths repo-relative so replay metadata remains portable.
- Prefer additive adoption: start with task, lock, evidence, and artifact mapping before introducing every optional store.
