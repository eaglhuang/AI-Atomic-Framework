# Taskflow Profile v1 Specification

This document defines the `taskflow.profile.v1` schema contract for the ATM taskflow sub-command.

## Objective

The `taskflow.profile.v1` schema specifies the capabilities and delegation configuration for a planning repository profile when operating under the target repository's taskflow orchestrator.

## Operator Entry Model

- `taskflow open` orchestrates the official governed opener entry.
- `tasks new` generates markdown templates through the existing plugin/generator surface.
- Host numbering, canonical output-path policy, and roster synchronization are supplied through `delegation.policy` (`TASK-AAO-0138B`).

## Taskflow Open Result Contract (`atm.taskflowOpenResult.v1`)

`taskflow open` reports orchestration through these primary fields:

| Field | Purpose |
|---|---|
| `openerMode` | `delegated-governed` or `template-only-fallback` |
| `writeSupport` | Whether `--write` may execute as the governed entry |
| `delegationContract` | Host opener availability and generation surface (`tasks-new`) |
| `diagnostics` | Codes, messages, and missing prerequisites |
| `orchestrationPlan` | Dry-run plan including the `tasks new` and `tasks import` commands that would run |
| `runtimeImport` | Write-mode runtime import result returned from `tasks import --write` |

### Opener mode rules

- `delegated-governed`: profile loaded, `delegation.openerPath` declared, and `delegation.writerInvocation.describeOnly` is `false`.
- `template-only-fallback`: any other state, including missing profile, describe-only host opener, or incomplete governed write inputs.

### Write gate

- `taskflow open --write` is allowed only in `delegated-governed` mode.
- When host-opener policy is configured, ATM may allocate `--task-id` and resolve `--output` from profile policy instead of requiring explicit operator input.
- When prerequisites fail, ATM fails closed with `ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK`.
- Governed write orchestrates `tasks new`, then immediately imports the generated card into ATM runtime via `tasks import --write`.

### Host-neutral policy fields (`delegation.policy`)

| Field | Purpose |
|---|---|
| `allocateTaskId.mode` | `host-opener` scans the configured planning directory using profile `format`; `fallback` requires explicit `--task-id`. |
| `resolveCanonicalOutputPath.mode` | `host-opener` applies the profile `pattern` with `${taskId}`; `fallback` requires explicit `--output`. |
| `rosterSyncPolicy` | `inline`, `follow-up-command`, or `none`. |
| `rosterSync.indexPath` | README roster table path used by `tasks roster update`. |
| `fallbackBehavior` | Explains why ATM remains in template-only fallback when host policy is unavailable. |

Roster synchronization uses `node atm.mjs tasks roster update` as the only official write path.

## Invariants

1. **Profile write flag**: `capabilities.supportsWrite` in the profile must remain `false`. ATM rejects profiles that attempt to declare direct profile write permission.
2. **Schema ID Verification**: Every profile must contain a `"schemaId"` field exactly equal to `"taskflow.profile.v1"`.
3. **Generation surface**: Markdown generation always flows through `tasks new` / `generateTaskCard`; `taskflow open` does not render templates directly.
4. **Runtime continuity**: `taskflow open --write` is not complete until the generated task card has been imported into `.atm/history/tasks` through `tasks import --write`.

## JSON Schema

Refer to [taskflow-profile.v1.json](../../schemas/taskflow-profile.v1.json) for the full JSON Schema definition.
