# MAO Logical Routing V1

## Purpose

MAO Logical Routing V1 defines the first neutral contract for multi-agent orchestration in ATM. It is a routing and admission model, not a second task ledger, second approval system, or replacement for `node atm.mjs next`.

This spec exists so `TASK-MAO-0002` through `TASK-MAO-0004` can implement route context schemas and CLI shape without guessing the architecture.

## Authority Boundary

ATM remains the single global authority for governed work.

- The task ledger owns task identity, status, closure, and evidence requirements.
- `atm next` owns deterministic route selection for user-requested work.
- Task direction locks own write boundaries for a claimed task.
- Evidence records own validator proof.
- Route contexts may cache local route memory, but they never become global truth.

A route context can describe what an agent intends to read, write, wait for, or hand off. It cannot mark a task done, bypass task close, override a direction lock, or publish generated runner artifacts without the owning steward lane.

## Architecture Roles

### Root Router

The root router is the deterministic entry point that converts a user prompt and repository state into one governed route.

Responsibilities:

- resolve task, batch, planning, review, or orientation intent;
- expose the playbook that must be followed before mutation;
- select normal, batch, review, or blocked channels;
- refuse ambiguous multi-task prompts unless a queue or explicit task is selected;
- preserve `node atm.mjs next --prompt "<prompt>" --json` as the user-requested entry.

Non-responsibilities:

- storing route-local scratch memory;
- performing conflict arbitration itself;
- applying patches or generated artifacts;
- becoming a parallel task registry.

### Route Context

A route context is a short-lived, machine-readable record for one active route.

It may contain:

- route id, task id, actor id, channel, and claim intent;
- declared read set and declared write set;
- target atom CIDs and virtual atom CIDs when known;
- validator plan and expected evidence;
- current route state;
- blocked-by reasons;
- optional patch envelope reference;
- optional team run reference.

It must represent unknown read or write sets explicitly. Unknown is not the same as empty.

Route context states for V1:

- `open`
- `admitted`
- `frozen`
- `waiting`
- `blocked`
- `ready-to-apply`
- `closed`
- `abandoned`

## Command Vocabulary

V1 defines command shape only. Individual commands are implemented by later tasks.

- `route open`: create or inspect a route context for a claimed task.
- `route admit`: classify route scope and decide whether the route can proceed.
- `route freeze`: pause mutation while preserving context and reason.
- `route resume`: re-check prerequisites and continue a frozen route.
- `route status`: show route, claim, lock, and evidence readiness.
- `route close`: retire a route context after task close or abandonment.

These commands must report stable JSON envelopes. They must not mutate task status unless they call the existing task lifecycle surfaces.

## Conflict Vocabulary

MAO V1 uses a small decision vocabulary.

| Verdict | Meaning |
| --- | --- |
| `allow` | Proceed inside current direction lock. |
| `watch` | Proceed, but keep explicit advisory diagnostics. |
| `freeze` | Pause mutation until a prerequisite, reviewer, or steward decision exists. |
| `serialize` | Run work in a single lane because parallelism is not safe. |
| `steward-required` | A neutral or single-writer steward must produce the final mutation. |
| `blocked` | Stop; no route-local action is safe. |

The vocabulary is intentionally smaller than the full Broker design. It gives Team Agents and route lifecycle code a shared language before full patch-envelope and ref-stream mechanics exist.

## Logical Admission Before Worktree Isolation

Worktree isolation only separates files physically. It does not answer whether two agents are modifying the same atom, generated artifact, validator surface, route state, or task lifecycle.

Logical admission comes first because it can evaluate:

- declared write set overlap;
- atom CID and virtual atom CID overlap;
- generated artifact single-writer rules;
- shared validators or schema surfaces;
- active leases and direction locks;
- whether the route should be Team Agents work, MAO Broker work, or Runner Sync Steward work.

Worktree isolation remains useful after admission, especially for external contributors or large experiments. It is not enough by itself for ATM governance.

## Team Agents Relationship

Team Agents are execution helpers under the root router. They may help plan, inspect, validate, and report, but they do not own task lifecycle.

Recommended rollout order:

1. Build a thin Team Agents control lane for captain decisions, role selection, runtime status, permission checks, and file-write scope validation.
2. Build MAO route foundation: this spec, route context schema, route lifecycle CLI, and `next` route selector.
3. Add MAO admission and conflict primitives: intent registry, conflict matrix, freeze/resume, patch envelope, and steward arbitration.
4. Extend Team Agents enforcement where it consumes route status and admission diagnostics.
5. Defer full Runner Broker refs, external contributor flow, and closure-runner binding until the lighter route model proves stable.

This preserves a lightweight mental model for ordinary agents: follow `atm next`, stay within the direction lock, record evidence, and let Captain or a steward handle higher-order conflicts.

## Runner Sync Steward Relationship

Runner Sync Steward V1 is the generated-artifact single-writer lane for ATM runner outputs. MAO must respect it.

- Ordinary source tasks may mark runner sync as needed.
- `release/**` publication remains steward-only.
- Route admission should classify runner-affecting source separately from generated runner artifacts.
- Full Runner Broker refs are a later extension, not a prerequisite for V1 route contexts.

## Invariants

- No route context can close a task without the existing task close flow.
- No route context can publish `release/**` unless the task is the runner steward lane.
- No route context can override `atm next` route selection.
- No route context can invent a separate task id or task status.
- Unknown scope must be explicit and should bias toward `watch`, `freeze`, `serialize`, or `blocked`.
- Team Agents reports are advisory until committed through existing evidence or task close surfaces.

## Implementation Notes For Follow-Up Tasks

`TASK-MAO-0002` should define the route context schema and TypeScript contract from this document.

`TASK-MAO-0003` should expose route lifecycle command shape without implementing conflict arbitration.

`TASK-MAO-0004` should connect `next` route selection to route context hints while preserving existing normal and batch playbooks.

`TASK-MAO-0005` and later Broker cards may add richer intent registry and conflict semantics, but they must adapt to this route model instead of replacing it.
