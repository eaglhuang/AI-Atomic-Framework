---
applyTo: "**"
---


# ATM Governance Router

Use this skill when a user asks in natural language to inspect, rank, clean up,
refactor, split, atomize, infect, migrate, or modernize existing source code.

The goal is to keep the user request natural while still routing the work
through ATM evidence before choosing a local implementation path.

If the natural-language request mentions a task id, task card, plan document, or
scoped task batch, invoke `atm-task-intent-resolver` first. It must write
`.atm/runtime/task-intent.json` from semantic reading of the user prompt and then
call:

```bash
node atm.mjs next --intent .atm/runtime/task-intent.json --json
```

Do not rely on keyword-only `next --prompt` extraction when the task intent
resolver skill is available.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

If the first command returns a user notice, surface it briefly, then continue the
original user request.

Before editing implementation files, inspect framework mode:

```bash
node atm.mjs framework-mode status --json
```

If the result mode is `required` or `cross-repo-target-required`, do not hand-edit
task status to `done`, do not bulk-close task cards, and do not treat static
`atomic_workbench/evidence/*.json` files as completion evidence. Claim/lock the
task, run `guard framework-development`, `tasks audit`, `doctor`, and the
required validators before closing with `tasks close`.

## Route Command

```bash
node atm.mjs guide --goal "$ARGUMENTS" --cwd . --json
```

This route is also referred to as the `atm guide --goal` workflow in validator
evidence and release documentation.

Validator shorthand terms for this route are `atm guide --goal`, `atm candidates rank`, `atm start --legacy-flow`, `atm next`, `dry-run proposal`, and `human review`.

Follow the returned `nextCommand`. If the matched intent is
`legacy-candidate-ranking`, run the candidate ranking command before doing local
source analysis by hand. If the matched intent is `task-plan-import`, run the
task import dry run before creating or editing any task files.

Before mutating repository files for implementation work, claim the prompt-scoped task:

```bash
node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --prompt "$ARGUMENTS" --json
```

ATM's default task ledger is the active flow monitor when `taskLedger.enabled`
is true. Use the repo-local `.atm/history/tasks` store for adopter work; use the
ATM framework repo ledger only when `framework-mode status` reports
`framework-development`. If the user provides an external task (GitHub Issue,
Jira, Linear, or another provider) and no ATM mirror exists yet, create the
visible mirror before implementation:

```bash
node atm.mjs tasks mirror --provider <provider> --origin-task <id> --origin-url <url> --actor "$ATM_ACTOR_ID" --json
```

If the editor provides pre-write hooks, keep them thin and run only:

```bash
node atm.mjs guard mutation --task <task-id> --actor "$ATM_ACTOR_ID" --files <csv> --json
```

If no hook is available, continue with task claim + `git prepare/check` +
`evidence verify` gates as the fallback safety boundary.

## Required Evidence

For legacy candidate ranking, final reasoning should cite or create:

- ATM guidance result
- candidate ranking artifact
- source inventory artifact
- police artifact
- recommended split, atomize, infect, or compose route

For task plan import, final reasoning should cite or create:

- ATM guidance result
- task import dry-run manifest
- written `.atm/history/tasks/*.json` paths, when `--write` is used
- task import evidence report path
- `tasks verify` report
- `next` result showing imported open work items, when available

## Task Plan Import Route

If the matched intent is `task-plan-import`, run the dry-run import first:

```bash
node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json
```

Confirm the parsed manifest before persisting. When the manifest looks correct,
run the write phase and verify:

```bash
node atm.mjs tasks import --from <plan.md> --write --cwd . --json
node atm.mjs tasks verify --cwd . --json
```

Do not hand-write `.atm/history/tasks/*.json` and do not reuse `atm create` for
work-item import; `atm create` is for atom birth.

## Guided Fallback

If preferred documents are missing, do not stop and do not silently improvise.
Preserve the fallback contract from ATM output:

- `missingDocs[]`
- `fallbackSources[]`
- `continuedOriginalRequest: true`

Then continue the user's original request with the fallback sources.

## Guardrails

- Do not rank legacy scripts with ad-hoc shell-only heuristics when ATM can
  produce candidate ranking evidence.
- Do not choose split, atomize, or infect before candidate ranking and police
  evidence exist.
- Do not mutate host files during candidate ranking; ranking is advisory until
  a later governed dry run is selected.
- Do not start implementation edits before a task is in `ready` and has an
  active claim.
- Do not bypass the default task ledger when it is enabled; task status changes
  must go through `tasks create/import/mirror/claim/block/close/abandon`.
- Do not mark task cards `done` by editing Markdown or JSON directly; use
  `node atm.mjs tasks close --status done` so closure evidence is checked.
- Do not bulk-complete multiple tasks without a bulk closure manifest and one
  closure packet per task.
- Do not use static JSON evidence files as proof of completion unless they carry
  command runs with exit codes and output hashes.
- Do not move heavy checks (build/lint/network) into hooks; hooks should only
  call thin ATM guard commands.
- Do not treat task-card import as atom birth; task-card import uses `tasks
  import`, while atom birth uses `create` or a governed atomize flow.
- Do not acquire runtime locks during import-only task-plan operations.
- Keep `.atm/history/tasks` as the canonical imported work-item store; host
  Markdown projections are optional secondary views.
- Keep host-local language and phrasing in evidence or host lexicons, not in
  this canonical skill.

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

## Charter Invariants

- `INV-ATM-001` — **No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` — **Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` — **Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` — **No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` — **Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` — **Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` — **Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
