---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-governance-router
title: ATM Governance Router
summary: Route natural-language cleanup, refactor, migration, and candidate ranking goals through ATM before local analysis.
command: node atm.mjs guide --goal "$ARGUMENTS" --cwd . --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when a user asks in natural language to inspect, rank, clean up,
refactor, split, atomize, infect, migrate, or modernize existing source code.

The goal is to keep the user request natural while still routing the work
through ATM evidence before choosing a local implementation path.

## Selective Learning Loop

When the router basically worked but the agent still felt friction, near-bypass,
or repeated uncertainty, do not read a monolithic lesson log by default.

Read order:

1. Read `references/index.md`.
2. Pick only the single shard that matches the current symptom.
3. Stop after the first relevant shard unless the blocker still remains
   unresolved.
4. Prefer durable rules already promoted into this `SKILL.md` or `atm-next`;
   use the shard files for examples, edge cases, and recovery patterns.

## Captain/Dispatch Entry Gate

If the user asks for Captain, Coordinator, dispatch, task cards, sidecars,
subagents, delegation, condition review, or closeout work, first route the
request through `ai-role-router` when available, then through `atm-dispatch`
before drafting instructions, delegating work, or reviewing another agent.

State `Skill used: atm-dispatch` and the chosen `Delegation mode`. Internal
sidecar is the default for review, preflight, grep, checklist, planning-only
checks, and post-report verification. External dispatch is opt-in, and external
write is forbidden unless the user explicitly grants write authority and scope.

## Highest Parallel Governance Principle

ATM parallel governance uses a Tier model:

- Reads never queue behind write lanes.
- Private writes to the actor's own ledger, evidence, notes, or planning
  artifacts never queue behind unrelated lanes.
- Shared writes to the git index, release mirrors, build artifacts, protected
  runtime state, or other shared mutation surfaces go through the broker, which
  answers with a ticket: execute now, enqueue with a position, or batch into a
  shared write window. A bare refusal at a shared-write gate is charter debt
  (INV-ATM-008), not a design choice.

The only standing serialization exceptions are the four owner-ruled cases in
`docs/governance/parallel-governance-charter.md` (one lane session per task
card; dependency gates block code only, never documents; the single-branch
commit core with related-task batching only; document writes are ungoverned,
code writes are always governed). Any new serialization point must be surfaced
to the project owner for an explicit ruling before it ships.

Use this model before widening a blocker. A natural-language request for
inspection, planning, evidence, or private ledger work should remain parallel
unless ATM identifies a concrete Tier 2 shared surface intersection.

## Delivery Principle

The objective is to deliver the task content, not to close task cards. A task
card is a delivery contract. `done` is only the record after the requested
code, data, pipeline, document, or artifact exists and validators/evidence pass.

Do not optimize for making many cards become `done`. Optimize for producing the
requested non-.atm deliverables for the current task or current batch queue
head.

## Governance Flow Backwrite

For Captain, dispatch, handoff, evidence, closeout, and first-layer governance
work, promote only stable rules into reusable skills. Historical task status,
dirty worktree residue, local commit shas, actor ids, queue ids, and
date-bound incident instructions belong in task evidence, backlog, handoff, or
learning references, not in this entry skill.

Before implementation on a governed card, record an opening data-driven
decision in the task evidence, close summary, or dispatch report:

- consumed sealed summaries;
- missing data;
- assumption changes;
- stop rule;
- whether the card adds, removes, or touches a shared-write gate.

For every shared-write gate touched by the route, apply the `INV-ATM-008`
check before accepting a blocker as normal: did the workflow turn a
coordinatable shared write into a bare refusal or terminal block, and is that
refusal one of the owner-ruled exceptions? If not, route through a broker
ticket, compose/steward path, queue ticket, or backlog item instead of
normalizing the refusal.

For repairs, follow `INV-ATM-009`: derive behavior from schemas, registries,
configuration, observed counters, canonical ErrorCodes, capability payloads,
or compact digest evidence. Do not hard-code task ids, actor ids, queue names,
local absolute paths, dates, or one incident's error string unless the task
records why the general rule is unsafe or infeasible.

Before closeout, check that evidence and telemetry include a window,
watermark, counters, duration/timing, source availability, compact digest, and
explicit unavailable receipts where data is missing. Raw runtime logs should
remain in runtime or gitignored storage; tracked history should carry compact
evidence.

If the route changes runner, release, broker shared-write behavior,
first-layer entry behavior, skill template projection, or generated
integration output, source tests alone are insufficient. Rebuild the frozen
runner when ATM says it is stale and run a frozen-entry smoke or probe before
claiming delivery.

If the natural-language request mentions a task id, task card, plan document, or
scoped task batch, invoke `atm-task-intent-resolver` first. It must write
`.atm/runtime/task-intent.json` from semantic reading of the user prompt and then
call:

```bash
node atm.mjs next --intent .atm/runtime/task-intent.json --json
```

Do not rely on keyword-only `next --prompt` extraction when the task intent
resolver skill is available.

{{ACTOR_IDENTITY_HANDOFF_GATE}}

## Tool-First Orchestration

Prefer a structured ATM tool or editor connector before shelling out when the
environment exposes one. Treat a blocked tool result as route truth: surface its
status, reason, `allowedCommands`, `blockedCommands`, user notice, and
`evidence.nextAction.command` before choosing any fallback.

Use CLI fallback only for read-only inspection, legacy editors, explicit user
fallback, unavailable tools, or a fallback command named by the structured
result. Do not replace a blocked tool route with an ad hoc shell workaround.

Keep this router thin. After `next`, `next --claim`, or the task-intent
resolver returns, delegate sequencing to `evidence.nextAction.playbook` and
specialist skills such as `atm-next`, `atm-evidence`, `atm-lock`,
`atm-dispatch`, and Team role packs. Preserve shared Team Agents fields when
they appear: `teamLevel`, `runtimeTier`, `decisionClass`, `decisionReason`,
`requiresHumanSignoff`, `requiresAdr`, `violationStatus`,
`escalationTarget`, and `broker-conflict-blocked`.

For Team Agents work, do not rely on the older assumption that `team start`
always means "no execution." Plain `team start` is still state-only, but
`team start --execute` is a governed provider orchestration lane. Route crew
completeness with `--team-size L1..L5`, route per-role providers with
`--role-provider role=provider:model[:sdk][:mode]`, and keep
`broker-conflict-blocked` as a hard gate.

## First Command

```bash
{{firstCommand}}
```

If the first command returns a user notice, surface it briefly, then continue the
original user request.

## First-Layer Command Contract

For backlog, audit, optimization, and create prompts, inspect the canonical
first-layer matrix before falling back to CLI discovery:

```bash
node atm.mjs guide first-layer --json
```

The matrix is `intent -> route -> command -> authority -> negative case`.
Backlog, audit, and governance/product optimization prompts are docs-first or
read-only status work until a scoped task/backlog record exists; they must not
fall through to `create-atom`. Explicit atom birth keeps the
`node atm.mjs guide create-atom --json` path.

Normal release/checkpoint/backlog/audit syntax should be visible from this
first layer:

```bash
node atm.mjs broker release --task <task-id> --actor <actor> --json
node atm.mjs batch checkpoint --actor <actor> --json
node atm.mjs guide first-layer --json
node atm.mjs tasks audit --json
```

Default `next` output is compact: it keeps blocker/status, recommended action,
ticket state, queue/revalidation/reconcile hints, and validator summary. Use
`--verbose --json` only when you need the full duplicated playbook body, large
file lists, or complete diagnostic arrays.

Ticket states are route truth. Preserve distinct next actions for
`execute-now`, `batch/applyStrategy=compose`,
`queue(position/head/health/waitedMs/release condition)`,
`revalidation-required`, `reconcile-required`, and R1 `ATM_LOCK_CONFLICT`.
Queued, compose, revalidation, and reconcile states are ticket/status states,
not new ErrorCodes. A waiting shared write still permits reads, docs, private
evidence, and isolated proposals; only intersecting dependent code side effects
are restricted.

For Windows Markdown/JSON/text planning docs, use Node UTF-8 reads and `rg`
searches:

```bash
node -e "const fs=require('node:fs'); console.log(fs.readFileSync(process.argv[1],'utf8').slice(0,4000))" -- <file.md>
rg "pattern" <path>
rg --files <path>
```

Do not recommend PowerShell range indexing or document parsing for planning
documents.

If `evidence.nextAction.governanceReadiness` is present, prepare those items
before you reach commit or push. Treat framework claim, protected push
evidence, `doctor`, and branch queue retry codes as early blockers, not as
something to discover only after a hook or push failure.

Turn `evidence.nextAction.governanceReadiness` into an immediate preparation
checklist before implementation:

1. Resolve actor identity now, not at commit time.
2. If framework claim is required, inspect `node atm.mjs framework-mode status --json` and acquire the returned `framework-mode claim` before editing framework-critical files. If the same actor left behind a stale-completed temporary framework lock, retry `framework-mode claim` directly and let ATM auto-reconcile it; do not invent a skill-side lock override.
3. If the route is on a protected or shared branch, run `node atm.mjs doctor --json` before the first governed write so readiness blockers surface early.
4. Use `governanceReadiness.upstreamRef` when present and run `node atm.mjs hook pre-push --base <upstream-ref> --head HEAD --json` proactively before the final push, or earlier once the branch is ahead, so git-head evidence and branch-queue blockers show up before the real push.
5. Treat `queueRetryCodes` as a shared-branch retry contract, not as an unexpected raw Git failure.

Before editing implementation files, inspect framework mode:

```bash
node atm.mjs framework-mode status --json
```

If the result mode is `required` or `cross-repo-target-required`, do not hand-edit
task status to `done`, do not bulk-close task cards, and do not treat static
`atomic_workbench/evidence/*.json` files as completion evidence. Claim/lock the
task, run `guard framework-development`, `tasks audit`, `doctor`, and the
required validators before closing with `tasks close`.

Before you consider implementation "finished", do one local static-hygiene
pass on the code you actually touched:

1. Fix syntax, import, and type errors that appear in the touched scope immediately instead of deferring them to CI or another agent.
2. Treat adapter-native static warnings in touched or staged files as part of the same delivery when the repair is straightforward and low-risk.
3. Do not use this rule to justify repo-wide cleanup drift; keep the cleanup narrow unless the route explicitly broadens scope.
4. Prefer lifting this habit into the operator workflow first, then let hooks and validators harden it later.

For ordinary task-card delivery, the lifecycle remains:

```text
claim -> implement -> validators -> evidence add -> tasks close -> commit
```

Framework critical files only change the close/commit timing when the close gate
blocks a live critical diff. If `tasks close` reports
`ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE`, do not bypass the gate. Make a governed
delivery commit for the scoped non-`.atm` deliverables, then run:

```bash
node atm.mjs tasks close --task <task-id> --actor "$ATM_ACTOR_ID" --status done --historical-delivery <commit> --json
```

After close succeeds, make a separate closure commit for the generated ATM
ledger updates. This historical-delivery path still requires validators and
command-backed evidence; it is not a relaxed closure rule.

## Route Command

```bash
{{command}}
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

If the claim result says `recommendedChannel: "batch"`, the governed route is:

1. Read `evidence.nextAction.playbook` before editing. Treat it as the
   step-by-step work order for this request.
2. Run `node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --prompt "$ARGUMENTS" --json`.
3. Deliver the current queue head only.
4. Run validators and add command-backed evidence for that queue-head deliverable.
5. Run `node atm.mjs batch checkpoint --actor "$ATM_ACTOR_ID" --json`.
6. Commit only after checkpoint succeeds, and commit the deliverables together
   with `.atm/history/tasks/<task>.json`,
   `.atm/history/evidence/<task>.json`, and
   `.atm/history/task-events/<task>/`.
7. Continue with the next queue head returned by the checkpoint response.

Do not manually loop through `tasks reserve`, `tasks promote`, `tasks claim`,
`tasks close`, or old close commits. That is governance bypass, not batch.
Do not commit before `batch checkpoint` succeeds.

If `recommendedChannel` is `fast` or `normal`, still read
`evidence.nextAction.playbook` first. It tells you the exact claim, evidence,
close, and commit order for that channel.

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
node atm.mjs write-ticket check --task <task-id> --actor "$ATM_ACTOR_ID" --ticket <ticket.json> --files <csv> --observed pre-write --json
```

Before a mutating implementation pass, acquire a task-scoped ticket:

```bash
node atm.mjs write-ticket acquire --task <task-id> --actor "$ATM_ACTOR_ID" --files <csv> --intent write --json
```

If no pre-write hook is available, immediately record touched files after the
write pass:

```bash
node atm.mjs write-ticket record-touch --task <task-id> --actor "$ATM_ACTOR_ID" --ticket <ticket.json> --files <csv> --observed post-write --json
```

Out-of-scope pre-write intent should route to
`ATM_WRITE_SCOPE_AMENDMENT_REQUIRED`. Already dirty out-of-scope work should
route to `ATM_WRITE_SCOPE_UNATTACHED_WIP` with recovery commands. Only
unresolved bypass at commit, close, or push should become
`ATM_WRITE_TICKET_SCOPE_VIOLATION`. Treat these as evidence consumed by the
broker/task-scope authority model, not as a second permission system.

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
- Do not treat task closure as the work. Implement the task's requested
  deliverables first, then close.
- Do not hand-roll batch task completion with low-level task lifecycle commands;
  if `recommendedChannel` is `batch`, finish each queue head with
  `node atm.mjs batch checkpoint --actor "$ATM_ACTOR_ID" --json`.
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
- Do not normalize a habit where agents leave fresh syntax, type, lint, or
  adapter-native warnings behind in files they just touched. Narrow-scope
  static cleanup is part of finishing the delivery, even before the lower
  governance gates become stricter.
- Do not treat multi-adapter `stale` parity as six unrelated incidents by
  default. When several installed adapters are only behind the same current
  template snapshot, refresh them as one governed parity batch and re-run
  `doctor` before continuing implementation.
- Do not link or junction a disposable worktree's `node_modules` back to the
  main repo. In npm workspace repos, cleanup can follow reparse points and
  remove tracked `packages/*` or `examples/*` files from the main worktree.
- Do not treat task-card import as atom birth; task-card import uses `tasks
  import`, while atom birth uses `create` or a governed atomize flow.
- Do not acquire runtime locks during import-only task-plan operations.
- Keep `.atm/history/tasks` as the canonical imported work-item store; host
  Markdown projections are optional secondary views.
- Keep host-local language and phrasing in evidence or host lexicons, not in
  this canonical skill.

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}
