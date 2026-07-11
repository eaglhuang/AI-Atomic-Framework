---
applyTo: "**"
---


# ATM Dispatch

Use this skill when the user asks for Captain, Coordinator, dispatch, task
cards, sidecars, subagents, delegation, condition review, mailbox work, or
closeout review.

State `Skill used: atm-dispatch` and the chosen `Delegation mode`.

Terminology boundary: ATM is the product, framework, CLI, and governance workflow. AI-Atomic-Framework is only this repository name; do not call ATM AAF.

Captain must apply atm-dispatch before any dispatch, sidecar delegation,
review, condition review, or closeout.

Delegation modes:

- `local`: the current agent does the work directly.
- `internal sidecar`: Internal sidecar is the default for review, preflight,
  grep, 審稿 / planning-only / checklist, and post-report verification.
- `external handoff`: External dispatch is opt-in. A separate agent/thread may
  receive a bounded task only when the user explicitly chooses that route.

External write is forbidden unless the user explicitly grants write authority
and scope.

## Actor Identity Handoff Gate

Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,
or governed `git ...` command, resolve this agent's explicit actor id.

- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.
- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.
- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.
- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.

## Dispatch Identity Rule

Captain identity and worker identity are separate authority lanes. A dispatch
card may transfer scope, acceptance criteria, and evidence requirements, but it
must not transfer the captain's runtime identity to the worker.

When assigning work, include the expected actor id or tell the worker to set one
before claiming. When receiving work, the worker must clear stale default
identity if the editor or repo was previously used by another agent, then set its
own actor-scoped identity before claim, edit, close, report, or commit.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

After every `next --prompt` or `next --claim` response, read
`evidence.nextAction.playbook` before drafting dispatch instructions, editing,
closing, or committing. The playbook is the short channel-specific work order.

## Dispatch Rules

- Do not create a parallel task model; route task-card work through ATM.
- Do not delegate write authority unless the user explicitly granted it.
- Prefer internal sidecars for review, grep, preflight, checklist, and
  post-report verification.
- Keep sidecars bounded: specify objective, read/write boundary, required
  evidence, stop condition, and report contract.
- For batch work, dispatch only the current queue head unless ATM returns a
  batch route and checkpoint plan.
- For closeout review, verify deliverables and evidence before saying a task is
  complete.

## Team Agents Dispatch Surface

When dispatching or reviewing Team Agents work, preserve the current runtime
surface instead of falling back to the older "manual advisory only" model:

- Use L1 through L5 as the canonical crew scale. L1 is Coordinator,
  Atomization Planner, Implementer, and Validator; L5 adds Lieutenant, Review
  Agent, and Knowledge Scout.
- Mention `--team-size L1..L5` when crew completeness matters, and
  `--role-provider role=provider:model[:sdk][:mode]` when a role needs a
  specific provider/model.
- Treat `team start --execute` as an explicit governed execution lane. The
  default `team start` remains state-only and does not spawn workers.
- Preserve runtime governance fields in reports: `decisionClass`,
  `decisionReason`, `requiresHumanSignoff`, `requiresAdr`,
  `violationStatus`, and `escalationTarget`.
- Treat `broker-conflict-blocked` as a hard stop. Do not tell workers to
  self-close, self-commit, or bypass Team Broker.
- If a task card declares `team.required: true`, closeout needs a completed Team
  run and summary before task close can proceed.

## Route Command

Use this ATM command only after the first command confirms dispatch is the
current governed route:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

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
