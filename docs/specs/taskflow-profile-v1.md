# Taskflow Profile v1 Specification

This document defines the `taskflow.profile.v1` schema contract for the ATM taskflow sub-command.

## Objective

The `taskflow.profile.v1` schema specifies the capabilities and delegation configuration for a planning repository profile when operating under the target repository's taskflow orchestrator.

## Operator Entry Model

- `taskflow open` orchestrates the official governed opener entry.
- `taskflow close` orchestrates the official governed closeback entry.
- `tasks new` generates markdown templates through the existing plugin/generator surface.
- `tasks close`, `tasks reconcile`, `tasks import`, and `tasks repair-closure` remain the authoritative backend operations.
- Host numbering, canonical output-path policy, and roster synchronization are supplied through `delegation.policy` (`TASK-AAO-0138B`).
- Host-specific task-card authoring, numbering, slugging, roster updates, and adaptor policy belong to the planning/adopter repo profile. ATM core only orchestrates the generic contract between the profile repo and target runtime.

## Adopter Integration Levels

ATM taskflow must not require every adopter to write a custom host adaptor before they can use dual-repo task governance. Adopters can choose one of three integration levels:

| Level | Required adopter work | Capability |
|---|---|---|
| Profile-only | Provide `taskflow.profile.json` with task id format, canonical output pattern, roster policy, opener metadata, and closeback roster policy. | `taskflow open --write` can create or reuse planning task cards in the profile repo and import them into the target runtime. `taskflow close --write` can close/reconcile the target runtime, update planning repo card/roster artifacts when the task source path is known, and return the deterministic dual-repo stage/commit bundle. |
| Light adaptor | Add a small host opener/closer wrapper around the profile policy, for example to customize slugging, numbering, local status fields, or roster formatting. | Same generic ATM flow, plus host-specific ergonomics. The adaptor may prepare local files, but target close/reconcile and governed bundle computation still flow through `taskflow close`. |
| Full adaptor / SDK | Implement a project-specific opener/closer facade that calls ATM taskflow commands and maps local project concepts into the profile contract. | Product-grade host UX while preserving ATM as the governed route. Full adaptors may hide command details from humans, but must not become a second close authority. |

The profile-only level is the minimum product contract. A new project should be able to adopt ATM task opening and closing by adding a clear profile file, without building a custom plugin. Host-specific adaptors should improve the experience, not become a prerequisite for basic dual-repo governance.

For closeback, the same layering applies:

- profile-only close uses the task source path from the imported runtime ledger to locate the planning/adopter repo, then stages the target close artifacts and planning card/roster files as one bundle;
- light adaptors may update host-local status fields before or during the taskflow close path, but they do not replace target runtime close/reconcile;
- full SDK integrations may expose a local "close task" button or command, but that facade must call `taskflow close` and preserve the `atm.taskflowGovernedCommitBundle.v1` result.

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
- When `--profile` points at a planning/adopter repository, canonical task-card output is resolved against that profile repository root. The target repository remains the `--cwd` runtime repo and receives the generated card only through runtime import.

### Host-neutral policy fields (`delegation.policy`)

| Field | Purpose |
|---|---|
| `allocateTaskId.mode` | `host-opener` scans the configured planning directory using profile `format`; `fallback` requires explicit `--task-id`. |
| `resolveCanonicalOutputPath.mode` | `host-opener` applies the profile `pattern` with `${taskId}` and optional `${slug}`; `fallback` requires explicit `--output`. |
| `rosterSyncPolicy` | `inline`, `follow-up-command`, or `none`. |
| `rosterSync.indexPath` | README roster table path used by `tasks roster update`. |
| `fallbackBehavior` | Explains why ATM remains in template-only fallback when host policy is unavailable. |

Roster synchronization uses `node atm.mjs tasks roster update` as the only official write path.

## Taskflow Close Result Contract (`atm.taskflowCloseResult.v1`)

`taskflow close` reports closeback orchestration through these primary fields:

| Field | Purpose |
|---|---|
| `closeMode` | `normal-close`, `historical-delivery-close`, `planning-mirror-sync-repair`, `residue-repair`, or `ambiguous-manual-review` |
| `writeSupport` | Whether `--write` may execute the governed closeback entry |
| `closebackPlan` | Backend surface, command, follow-up steps, writer boundary, and evidence validators |
| `governedCommitBundle` | Dual-repo exact-path stage/commit bundle (`atm.taskflowGovernedCommitBundle.v1`) |
| `residueDiagnosis` | Reuses `atm.taskResidueDiagnosis.v1` truth/residue classification |
| `delegationContract` | Same adopter-aware writer/roster boundary as `taskflow open` |

### Close mode rules

- `normal-close`: live ledger is ready for `tasks close`.
- `historical-delivery-close`: residue or delivery context requires `tasks close --historical-delivery` or `tasks reconcile`.
- `planning-mirror-sync-repair`: planning mirror residue routes to `tasks import`.
- `residue-repair`: interrupted close routes to `tasks repair-closure`.
- `ambiguous-manual-review`: fail closed; operator must inspect `tasks status` / `tasks finalize diagnose`.

### Write gate

- `taskflow close --write` requires `--task` and `--actor`.
- Ambiguous residue fails closed with `ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE`.
- Planning-mirror closeback reuses `tasks import` and `tasks roster update`; ATM does not add a second closeback writer.
- When a profile is supplied, relative roster/index paths are resolved against the planning/adopter repository that owns the task source path, not against the target runtime repo.
- `taskflow close --write` always exact-stages the target repository closeout artifacts and planning repository closeback artifacts.
- `taskflow close --write` auto-commits both repositories by default, target first and planning second.
- `taskflow close --write --no-commit` keeps mandatory dual-repo exact staging but returns deterministic commit commands without committing.
- `taskflow close --dry-run` never stages or commits; it returns a bundle preview.
- If either repository's stage-file set cannot be computed, ATM fails closed before writing with `ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE`.

## Taskflow Governed Commit Bundle (`atm.taskflowGovernedCommitBundle.v1`)

`taskflow close` reports the dual-repo closeback bundle through these fields:

| Field | Purpose |
|---|---|
| `targetRepo.repoRoot` | Target repository root used for exact-path staging |
| `targetRepo.stageFiles` | Deterministic target files to stage, including task JSON, evidence, closure packet, and task-events |
| `targetRepo.commitMessage` | Commit message for the target closeout bundle |
| `targetRepo.commitCommand` | Deterministic recovery command for the target commit |
| `targetRepo.commitSha` | Commit SHA when auto-commit succeeds |
| `targetRepo.status` | `preview`, `staged`, `committed`, `skipped`, `failed`, or `uncomputed` |
| `planningRepo.*` | Same fields for the planning repository closeback bundle |
| `commitMode` | `dry-run`, `stage-only`, or `auto-commit` |
| `failClosed` | `true` when the bundle cannot be computed or a partial commit failure requires operator recovery |
| `recoveryCommand` | Command to run when target commit succeeded and planning commit failed |

## Invariants

1. **Profile write flag**: `capabilities.supportsWrite` in the profile must remain `false`. ATM rejects profiles that attempt to declare direct profile write permission.
2. **Schema ID Verification**: Every profile must contain a `"schemaId"` field exactly equal to `"taskflow.profile.v1"`.
3. **Generation surface**: Markdown generation always flows through `tasks new` / `generateTaskCard`; `taskflow open` does not render templates directly.
4. **Runtime continuity**: `taskflow open --write` is not complete until the generated task card has been imported into `.atm/history/tasks` through `tasks import --write`.
5. **Repository boundary**: Profile-owned output paths are planning/adopter-repo paths. ATM must not treat them as target-repo-relative merely because the operator runs `taskflow open` from the target repo.
6. **Close bundle isolation**: `taskflow close` may stage only the deterministic bundle files it reports; unrelated dirty files in either repository must not enter the bundle.

## JSON Schema

Refer to [taskflow-profile.v1.json](../../schemas/taskflow-profile.v1.json) for the full JSON Schema definition.
