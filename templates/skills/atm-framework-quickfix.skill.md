---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-framework-quickfix
title: ATM Framework Quickfix
summary: Execute a bounded, evidence-backed ATM framework quickfix for a severe recurring blocker. Use when a captain needs to restore a broken fast path, control-plane latency, commitability, or fail-closed boundary without waiting for a broad governance closeout.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
owner: atm-framework
tier: specialist
installProfiles: [framework-full, role-oriented]
invocationPolicy: model-or-user
companionFiles: []
adapterCapabilityRequirements:
  - "*:charter-injection"
---

# {{title}}

Use this only for a repeatable ATM framework defect with a narrow repair boundary.
It accelerates restoration; it never declares a plan, release, or task complete.

## Admit

Use this route only when all are true:

- The symptom is current, reproducible, and framework-owned.
- The smallest causal repair has a bounded file scope and focused validator.
- The repair preserves or strengthens fail-closed behavior.
- A normal task card is absent or too slow to restore a broken framework fast path.

Do not use it for broad refactors, release publication, bulk cleanup, task-card closure, or foreign `.atm/history/**` mutation.

## Workflow

1. Read `README.md`, then run:

   ```bash
   node atm.mjs next --prompt "<current request>" --json
   ```

   Read `evidence.nextAction.playbook`. Stop if its scope conflicts with a live owner.

2. Diagnose before writing. Capture the exact error code, current authority facts, and the smallest focused reproduction. Prefer `node atm.mjs ... --dry-run --json` or `node atm.dev.mjs` only for source-first framework validation.

3. State the generalized repair rule. Fix the capability seam, not the last observed task id, path, actor, timeout, or symptom.

4. Acquire one cohesive temporary claim:

   ```bash
   node atm.mjs framework-mode claim --actor <actor> --files "<comma-separated paths>" --reason "<bounded repair>" --json
   ```

   Keep all preparation outside shared queues. Do not touch foreign staged bytes or runtime state manually.

5. Implement the smallest patch and run only the selected focused validator plus encoding validation for touched text files.

6. Dry-run the governed commit. For a temporary framework claim, use the taskless facade: the live temporary lock is the authority.

   ```bash
   node atm.mjs git commit --actor <actor> --message "<summary>" --auto-stage --dry-run --json
   ```

   Never pass `--task ATM-FRAMEWORK-TEMP-*`: that id identifies a lock, not a task-ledger record.

7. Commit through the normal facade when possible. Use an emergency lease only if a current, separately evidenced framework defect blocks that facade. The lease must be single-use, path-bounded, flag-bounded, and explain why the normal route cannot proceed.

8. Verify the resulting commit contains exactly the claimed files, release the temporary claim immediately, and record the root cause in the ATM backlog. Mark source repair, frozen publication, and formal governance closure as separate states.

## Non-negotiable checks

- Fail before expensive builds, queue admission, staging, or lease consumption when a precondition is known.
- A quickfix cannot weaken scope, ownership, evidence, or validation requirements.
- Do not call a focused green result a Plan completion.
- Do not rebuild or publish a frozen runner unless the repair requires publication and the runner-sync broker names this lane queue-head.
- Preserve foreign residue; report it or create a bounded cleanup task instead of deleting it opportunistically.

## Completion report

Report: causal rule, exact files, focused command and result, commit SHA, whether an emergency lease was used, backlog item, temporary-lock release, and the three separate states: source repair, frozen publication, formal closeout.

