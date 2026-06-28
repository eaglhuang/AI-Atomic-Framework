# ATM Governance Router Learning Index

Use this index only when `atm-governance-router` already routed the work, but
the agent still feels friction, confusion, or near-bypass pressure.

Default rule: do not load every lesson file.

Read order:

1. Stay in `SKILL.md` and `atm-next` if the promoted rule already answers the
   problem.
2. If not, pick one shard below that matches the current symptom.
3. Stop after the first relevant shard unless the blocker still remains
   unresolved.

## Shard Selector

### `entry-friction.md`

Read when the issue is mostly about first-touch route selection, `next`, claim,
task import, queue discovery, or choosing the narrowest lane.

Typical symptoms:

- the router found the task, but claim still feels ambiguous;
- the agent wants to widen from one card to a whole plan too early;
- imported work exists, but the operator keeps rediscovering the lane.

### `route-interpretation.md`

Read when the route technically exists, but the operator is misreading ATM's
returned status, playbook, or next step.

Typical symptoms:

- `ready`, `task-no-work`, `framework-temp-claim-required`, or `playbook
  required` is interpreted too loosely;
- the agent knows a command result changed, but not what action that implies;
- a status code is mistaken for an implementation blocker instead of a routing
  instruction.

### `boundary-confusion.md`

Read when the issue is mostly about planning truth vs target truth, dependency
blockers, stale imports, or governance closure state.

Typical symptoms:

- a prerequisite looks undone, but planning source says `done`;
- the blocker may be missing snapshots or stale import truth;
- the target ledger says the dependency is incomplete for governance reasons.

### `fallback-design.md`

Read when the preferred tool-first route failed and the agent needs the
strongest fallback without silently weakening the workflow.

Typical symptoms:

- a specialized command is missing and the fallback path is unclear;
- a weaker manual workaround is tempting, but the governed CLI fallback should
  still exist;
- the agent is about to replace a precise ATM route with a noisier shell habit.

### `tooling-mismatch.md`

Read when the issue is mostly about runner surface differences, frozen vs
source-first proof, or tracked governance residue created by setup commands.

Typical symptoms:

- one repo exposes `taskflow` or `evidence run`, the other does not;
- source-first validation passed, but frozen-runner proof is still unknown;
- identity or setup commands create tracked diffs that look like noise.

## Capture Rule

When adding new lessons, prefer the smallest shard that matches the problem.
Promote only the durable rule into `SKILL.md` or `atm-next`; keep the fuller
story in the shard file.
