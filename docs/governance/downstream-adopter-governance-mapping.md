# Downstream Adopter Governance Mapping Note

This note documents one downstream mapping strategy for the default ATM governance contracts.
It is an adopter example, not part of the upstream schema contract.
Adopter-specific names have been replaced with generic placeholders (`adopter-private-name`, `downstream-game-repo`).

## Goal

A downstream adopter that already has a docs-first workflow, task lock tooling, generated artifacts, and registry shards
does not need to create a literal `.atm/` tree to benefit from the upstream governance schemas.
Instead, an adapter can map the logical stores onto the existing surfaces.

## Suggested Mapping

| Governance surface | Default `.atm` contract | Example downstream mapping |
| --- | --- | --- |
| work item store | `.atm/history/tasks` | adopter task card directory (e.g. `docs/tasks/*.md` or equivalent) |
| scope lock store | `.atm/runtime/locks` | adopter-managed lock records produced by host lock tooling |
| document index | `.atm/catalog/index` | adopter document registry shards or equivalent index structure |
| shard store | `.atm/catalog/shards` | adopter task JSON shards and document registry shards |
| artifact store | `.atm/history/artifacts` | `artifacts/` or host-approved artifact directory |
| log store | `.atm/history/logs` | generated run logs under host-approved log sinks |
| run report store | `.atm/history/reports` | validation and workflow reports under host-approved output paths |
| state store | `.atm/runtime/state` | markdown/json state files tracked under host-approved paths |
| evidence store | `.atm/history/evidence` | evidence JSON stored beside reports or other generated artifacts |
| context summary store | `.atm/history/handoff` | generated handoff summaries or task-level context summaries |
| adapter reports | optional | adapter-specific JSON reports under host-approved output paths |

## Important Constraint

The mapping layer should preserve the upstream record shapes even when the physical folders differ.
A downstream adapter can write `atm.governanceBundle`, `atm.evidence.*`, or `atm.contextSummary` documents
into adopter-specific paths without forking the schema family.

## Practical Rules

- Treat the upstream schema as the portable contract and the downstream path as an adapter concern.
- Reuse existing host task cards and lock tooling instead of duplicating them into a second tracker.
- Keep artifact and evidence paths repo-relative so replay metadata remains portable.
- Prefer additive adoption: start with task, lock, evidence, and artifact mapping before introducing every optional store.
