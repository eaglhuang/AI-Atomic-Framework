---
task_id: TASK-CID-0120
title: "Broker active read-set registry for symmetric dependency admission"
status: planned
priority: P1
closure_authority: target_repo
depends_on:
[]
scopePaths:
  - "packages/core/src/broker/types.ts"
  - "packages/core/src/broker/registry.ts"
  - "packages/core/src/broker/decision.ts"
  - "packages/core/src/broker/conflict-matrix.ts"
  - "packages/core/src/broker/team-wave-admission.ts"
  - "packages/core/src/git/admission.ts"
  - "packages/core/src/broker/__tests__/decision.test.ts"
  - "packages/core/src/broker/__tests__/conflict-matrix.test.ts"
  - "packages/core/src/broker/__tests__/intent-registry.test.ts"
  - "docs/CID_SEMANTICS.md"
  - "docs/ai_atomic_framework/arxiv-paper-v1/paper.v3.1.md"
deliverables:
  - "ActiveWriteIntent persists read-set resource keys derived from WriteIntent.readAtoms."
  - "Broker admission blocks both D(new) intersect W(active) and W(new) intersect D(active)."
  - "Regression tests cover symmetric read/write dependency hazards and legacy registry compatibility."
  - "CID semantics documentation and paper draft describe the symmetric dependency rule honestly."
validators:
  - "npm run typecheck"
  - "node --strip-types packages/core/src/broker/__tests__/decision.test.ts"
  - "node --strip-types packages/core/src/broker/__tests__/conflict-matrix.test.ts"
  - "node --strip-types packages/core/src/broker/__tests__/intent-registry.test.ts"
  - "git diff --check"
atomizationImpact:
  ownerAtomOrMap: "atm.cid-broker-map"
  mapUpdates:
    - path_pattern: "packages/core/src/broker/**"
      atom_id: "atm.cid-broker.admission"
      capability: "CID broker admission and active intent resource-key governance"
      coverage_status: "active"
outOfScope:
  - "Changing verdict taxonomy or adding a new conflict verdict."
  - "Changing release onefile/root-drop artifacts unless a separate runner-sync task is opened."
nonGoals:
  - "Do not upgrade WriteIntent schemaId/specVersion for this compatibility-preserving field addition."
  - "Do not implement dynamic runtime read tracking beyond declared WriteIntent.readAtoms."
contextMap:
  primary:
    - path: "packages/core/src/broker/types.ts"
      reason: "ActiveWriteIntent resource-key schema extension."
    - path: "packages/core/src/broker/decision.ts"
      reason: "Primary broker admission verdict logic."
    - path: "packages/core/src/broker/conflict-matrix.ts"
      reason: "Structured conflict-class reporting must match broker verdict logic."
  secondary:
    - path: "packages/core/src/broker/registry.ts"
      reason: "Runtime active intent registration must persist declared read sets."
    - path: "packages/core/src/broker/team-wave-admission.ts"
      reason: "Wave-mode active intents must carry read-set keys."
    - path: "packages/core/src/git/admission.ts"
      reason: "Synthetic git admission active intents should remain schema-compatible."
    - path: "docs/CID_SEMANTICS.md"
      reason: "Canonical CID semantics should document symmetric read/write dependency admission."
    - path: "docs/ai_atomic_framework/arxiv-paper-v1/paper.v3.1.md"
      reason: "Paper formalization must align with implementation."
  tests:
    - path: "packages/core/src/broker/__tests__/decision.test.ts"
      reason: "Regression coverage for broker verdicts."
    - path: "packages/core/src/broker/__tests__/conflict-matrix.test.ts"
      reason: "Regression coverage for structured conflict classes."
    - path: "packages/core/src/broker/__tests__/intent-registry.test.ts"
      reason: "Registration and legacy compatibility coverage."
  patterns:
    - referencePath: "packages/core/src/broker/__tests__/decision.test.ts"
      referenceTaskId: "TASK-CID-0120"
      description: "keeps broker admission tests small, direct, and source-level."
---

## Goal
Persist declared read-set resource keys in the active broker registry so CID admission can enforce the symmetric read/write dependency rule used by the paper formalization:

```text
(D(I) intersects W(I')) or (W(I) intersects D(I')) => SERIAL / blocked admission
```

## Acceptance
- Active intents registered from ordinary broker lifecycle paths carry optional read atom ID/CID keys derived from `WriteIntent.readAtoms`.
- `calculateBrokerDecision` blocks a new writer when it would modify an atom currently read by an active intent.
- `evaluateConflictMatrix` reports the same symmetric read/write dependency class.
- Existing registries without read-set fields remain valid via optional fields / empty-list normalization.
- `docs/CID_SEMANTICS.md` and `paper.v3.1.md` describe the symmetric dependency rule without overstating dynamic runtime read tracking.

## Exclusion Rules
- No verdict taxonomy expansion.
- No release artifact sync in this task unless explicitly requested after source validation.
- No direct mutation of unrelated dirty runtime or release files.

## Verification
Run standard AAF validators:
```bash
npm run typecheck
node --strip-types packages/core/src/broker/__tests__/decision.test.ts
node --strip-types packages/core/src/broker/__tests__/conflict-matrix.test.ts
node --strip-types packages/core/src/broker/__tests__/intent-registry.test.ts
git diff --check
```

## Closure & Reports
1. Provide files list and lines added.
2. Confirm validators pass.
3. Report that release runner sync was intentionally not touched unless separately requested.
