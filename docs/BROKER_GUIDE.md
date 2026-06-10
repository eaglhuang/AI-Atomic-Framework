# Broker Guide

This guide documents the write-broker surface that coordinates concurrent agent writes: `WriteIntent`, `calculateBrokerDecision()`, and the candidate bridge.

## Write Intents and Decisions

`packages/core/src/broker/types.ts` defines `WriteIntent` (task, actor, base commit, target files, atom refs, shared surfaces, requested lane) and `BrokerDecision`. `calculateBrokerDecision(newIntent, registry)` in `decision.ts` checks the new intent against all active intents and returns one of four primary verdicts:

| Verdict | Lane | Meaning |
|---|---|---|
| `parallel-safe` | `direct-brokered` | No CID, shared-surface, or file overlap; write proceeds in parallel |
| `needs-physical-split` | `deterministic-composer` | Same physical file but CID-disjoint; routed to the composer |
| `blocked-cid-conflict` | `blocked` | Atom ID or semantic CID collision with an active intent |
| `blocked-shared-surface` | `blocked` | Generator / projection / registry / validator / artifact collision |

## Candidate Bridge (TASK-ASP-0004)

`packages/core/src/broker/candidate-bridge.ts` converts atom candidates discovered by language adapters (plugin-sdk `AtomCandidate`, TASK-ASP-0001) into a well-formed `WriteIntent`, so callers no longer hand-build `atomRefs`, `targetFiles`, and `sharedSurfaces`:

```typescript
import { candidatesToWriteIntent, calculateBrokerDecision } from '@ai-atomic-framework/core';

const intent = candidatesToWriteIntent(candidates, {
  taskId: 'TASK-X',
  actorId: 'agent-a',
  baseCommit: 'abc123'
});
const decision = calculateBrokerDecision(intent, registry);
```

Behavior:

- **Deterministic `atomCid`** — SHA-256 of the canonical candidate contract `(kind || symbol || sortedSourcePaths || detectionMethod)`. The same candidate yields the same CID across runs, which is what lets the broker detect two agents claiming the same semantic unit.
- **`atomId`** — uses the candidate's `suggestedAtomId` when present, otherwise falls back to `ATM-AUTO-<cid-prefix>`.
- **`targetFiles`** — deduplicated, sorted union of each candidate's `filePath` and `suggestedSourcePaths`.
- **`sharedSurfaces`** — empty by default; pass `ctx.sharedSurfaces` to declare generators, projections, registries, validators, or artifacts.
- **`requestedLane`** — `'auto'` by default (the broker decides); override with `ctx.requestedLane`.
- **Read-only and pure** — the bridge never mutates candidate input, never calls an LLM, and needs no language-specific semantics.

Because `@ai-atomic-framework/plugin-sdk` depends on core, the bridge declares a structural `BridgeAtomCandidate` mirror instead of importing the SDK type; plugin-sdk `AtomCandidate` values are directly assignable (covered by `__tests__/candidate-bridge.test.ts`).

## Tests

```bash
node --strip-types packages/core/src/broker/__tests__/candidate-bridge.test.ts
```

Scenarios covered: multi-candidate intent shape, deterministic CID, parallel-safe, CID conflict (`blocked-cid-conflict`), same-file CID-disjoint routing (`needs-physical-split`), and read-only input.
