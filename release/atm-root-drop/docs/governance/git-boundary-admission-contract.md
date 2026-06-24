# Git Boundary Admission Contract

ATM should extend broker admission to the Git boundary at `git push`, not at
every local commit.

## Purpose

The Git-boundary lane compares the local branch delta that is about to be
published with the current remote branch delta from the same merge base. ATM
then routes that pair through the existing broker, composer, steward, and
evidence model instead of inventing a second conflict engine.

This contract locks the G0 architecture for `TASK-GIT-0001`.

## Boundary

- Git still owns object storage, refs, fetch, push, commit history, and remote
  transport.
- ATM owns semantic admission, conflict explanation, composer routing,
  deterministic merge planning, steward dry-run/apply, and command-backed
  evidence.
- MVP gates at pre-push only. Local `git commit` remains cheap and flexible.

## Delta Model

For the selected branch:

- `base`: `git merge-base HEAD origin/<branch>`
- `local`: diff from `base..HEAD`
- `remote`: diff from `base..origin/<branch>`

The remote branch is represented as a virtual actor:

- `virtual:git-remote@<sha>`

`<sha>` is the resolved remote tip commit used for the admission run.

## Admission Flow

1. Fetch remote metadata without mutating source files.
2. Resolve the merge base.
3. Convert `local` and `remote` deltas into broker mutation requests.
4. Use structured adapters when available.
5. Fall back to conservative text-range conflict keys when no structured
   adapter exists.
6. Submit the pair to broker admission.
7. Return one of the governed verdicts below.

## Command Contract

MVP command surface:

```bash
node atm.mjs git admit --branch <name> [--json]
```

Related operator surfaces:

```bash
node atm.mjs integration hooks verify git-pre-push --json
node atm.mjs git recover-push-fail --branch <name> [--json]
node atm.mjs git commit --no-verify --emergency-approval <leaseId> --reason "<why>"
```

Required behavior:

- default mode is read-only and does not push, commit, or auto-apply;
- `--json` is stable enough for pre-push hooks and evidence collection;
- human-readable mode names branch, base commit, local tip, remote tip,
  affected files, verdict, and next step;
- composer-routed cases may offer a separate steward dry-run/apply lane, but
  never auto-commit by default.

Operator policy notes:

- local hook install/verify is detectable but bypassable by the local operator;
- `--no-verify` is an emergency operator lane, not a normal fast path;
- protected branches, CI gates, and server-side enforcement are future
  deployment policy, not an MVP guarantee of local hooks.

## Verdict Matrix

| Verdict | Meaning | Operator result |
| --- | --- | --- |
| `allow` | No semantic conflict was found between local and remote deltas. | Push may continue. |
| `block` | A true overlap or protected conflict was found. | Stop push and explain the conflict plus recovery path. |
| `composer-routed` | Same-file changes are mergeable through deterministic composer semantics. | Stop direct push, emit a merge plan, and optionally offer steward dry-run/apply. |
| `no-op` | No publishable local delta exists relative to the merge base. | Explain that there is nothing new to admit. |
| `internal-error` | Admission could not complete deterministically. | Fail closed with diagnostics and evidence pointers. |

## JSON Result Contract

The JSON result should include at least:

- `schemaId`
- `verdict`
- `lane`
- `branch`
- `baseCommit`
- `localCommit`
- `remoteCommit`
- `remoteActorId`
- `targetFiles`
- `conflictKeys`
- `nextStep`
- `evidencePath`

Suggested lane values:

- `allow`
- `block`
- `composer`
- `steward-dry-run`
- `error`

## Exit Codes

- `0`: allow or no-op
- `10`: blocked conflict
- `11`: composer-routed manual follow-up required
- `12`: unsupported or fail-closed admission state
- `1`: internal error

The exact numeric values may be refined in implementation, but they must stay
distinct across allow, blocked, composer-routed, and internal-error outcomes.

## Evidence Contract

The Git-boundary lane must reuse the existing evidence model.

- Do not introduce a new broker envelope schema for MVP.
- Evidence should live under the normal ATM history surface.
- Admission runs should be referenceable from task evidence and dogfood reports.

Expected evidence shapes:

- command-backed run record for the admit command
- broker/composer/steward evidence when those lanes are used
- task-level evidence references for GIT-series cards

## Non-Goals

- No every-commit mandatory gate
- No automatic push
- No automatic commit after steward apply by default
- No server-side policy guarantee in MVP
- No promise to semantically merge every unknown file type

## Follow-on Work

- `TASK-GIT-0002`: build local/remote mutation requests from Git deltas
- `TASK-GIT-0003`: bridge Git deltas into structured adapter conflict keys
- `TASK-GIT-0004`: expose `git admit` CLI output and JSON
- `TASK-GIT-0005` onward: hook wiring, evidence, fallback, docs, and dogfood
