# TASK-RFT-0011 — ATM governance fix wave

Three surgical fixes for ATM CLI defects surfaced by TASK-RFT-0010's close
path. Each defect is fixed by extracting a small Policy Object atom, wiring it
back into the host command, and shipping a focused spec.

## Fix #1 — taskflow auto-evidence npm-script mapping

**Symptom.** `taskflow close --write --auto-evidence` on a task card that
declared `node --strip-types scripts/<name>.ts` was rewritten to
`npm run <name>` unconditionally by `evidence.ts::resolveValidatorExpectedCommand`.
When no `<name>` npm script existed, evidence.ts spawned the missing npm
script and threw `ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND`.

**Fix.** New Policy Object
`packages/cli/src/commands/taskflow/auto-evidence-mapper.ts` exports
`mapAutoEvidenceCommand(declaredCommand, packageJson)` and returns the command
auto-evidence should actually spawn:

- Declared matches `node --strip-types scripts/<name>.ts <tail?>` AND
  `packageJson.scripts[<name>]` maps to the same invocation (identical tail)
  → return `npm run <name>`.
- Otherwise (missing script, mismatched tail, malformed shape) → return the
  declared command verbatim.

`taskflow.ts` reads `package.json` once per close and passes a mapper into
`executeAutoEvidencePlan` via a new optional `commandMapper` argument on
`evidence.ts::executeAutoEvidencePlan`. Evidence.ts stays ignorant of npm
script equivalence; the policy lives in one place.

**Spec.**
`packages/cli/src/commands/taskflow/__tests__/auto-evidence-mapper.spec.ts`
covers: known npm script → npm form; matching tail; mismatched tail; unknown
script → verbatim; null package.json; malformed declared → verbatim.

## Fix #2 — tasks import reset-open UX

**Symptom.** When Captain writes `status: in-progress` into the planning
frontmatter up-front (the normal Phase 0 → Phase 1 handoff), the runtime
ledger inherits that status. `next --claim` refuses to open. The documented
remediation `tasks import --write --reset-open` was emergency-gated
(`ATM_EMERGENCY_LANE_APPROVAL_REQUIRED`), forcing an unnecessary emergency
lease.

**Fix.** New Strategy Map classifier in
`packages/cli/src/commands/tasks/import-verify.ts`:

```
export function classifyResetOpenImport(input): {
  state: 'fresh-open'
       | 'planning-in-progress-no-runtime'
       | 'drift-with-active-claim'
       | 'drift-without-claim';
  resetOpenEmergencyRequired: boolean;
  reason: string;
}
```

`tasks.ts::runTasksImport` peeks the plan markdown for
`status: <value>` and reads `.atm/history/tasks/<taskId>.json` to detect an
active claim. It calls the classifier BEFORE the emergency gate. When the
state is `planning-in-progress-no-runtime` or `fresh-open`, the reset-open
flag no longer triggers the emergency requirement. `drift-with-active-claim`
and the conservative `drift-without-claim` state keep the gate armed.

`--force` and other emergency-tier flags remain fully gated. Only the
false-positive trigger for `--reset-open` in the benign handoff case is
removed.

**Spec.**
`packages/cli/src/commands/tasks/__tests__/import-reset-open-ux.spec.ts`
covers all four states and asserts the emergency gate stays only on the
`drift-*` states.

## Fix #3 — broker verdict vs CID gate parity

**Symptom.** `broker register` returned `parallel-safe` / `lane:
direct-brokered` via `packages/core/src/broker/conflict-matrix.ts`, but the
same task could still trip `ATM_NEXT_CLAIM_BLOCKED` on the separate CID logic
in `next.ts::runNext`. Contradictory verdicts broke trust in the broker
verdict.

**Fix.** New Policy Object
`packages/cli/src/commands/next/claim-admission.ts` exposes
`evaluateClaimAdmission({ brokerVerdict, cidVerdict, ... })`. The broker
verdict is the final admission decision; the CID verdict is preserved as a
diagnostic wrapper. When the two disagree the module surfaces
`ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE` so future regressions become
visible.

`next.ts` claim-admission block now routes its allow/block decision through
`evaluateClaimAdmission`. The BrokerArbitrationVerdict type is imported
directly from `packages/core/src/broker/conflict-matrix.ts` so both `broker
register` and `next --claim` share the same verdict shape.

**Spec.**
`packages/cli/src/commands/next/__tests__/claim-admission-broker-parity.spec.ts`
covers: broker admits + CID admits; broker blocks + CID blocks; broker admits
+ CID blocks (divergence, broker wins); broker blocks + CID admits
(divergence, broker wins); overlap advisory; takeover advisory; direct
`detectBrokerCidDivergence` matrix.

## Validators

- `npm run typecheck`
- `npm run validate:cli`
- `npm run validate:governance-fix-wave` (new; registered in package.json so
  the auto-evidence mapper's npm-script equivalence rule can dogfood itself
  in future closes)
- Direct spec runs via `node --strip-types`

## Files touched (all in AI-Atomic-Framework)

**New files.**
- `packages/cli/src/commands/taskflow/auto-evidence-mapper.ts`
- `packages/cli/src/commands/next/claim-admission.ts`
- `packages/cli/src/commands/taskflow/__tests__/auto-evidence-mapper.spec.ts`
- `packages/cli/src/commands/tasks/__tests__/import-reset-open-ux.spec.ts`
- `packages/cli/src/commands/next/__tests__/claim-admission-broker-parity.spec.ts`
- `scripts/validate-governance-fix-wave.ts`
- `docs/reports/atm-governance-fix-wave.md` (this file)

**Edited files.**
- `packages/cli/src/commands/taskflow.ts` (mapper wired into
  `executeAutoEvidencePlan`; `readPackageJsonForAutoEvidence` helper)
- `packages/cli/src/commands/tasks.ts` (classifier consumed;
  `classifyResetOpenImportForOptions` helper)
- `packages/cli/src/commands/tasks/import-verify.ts` (classifier atom)
- `packages/cli/src/commands/next.ts` (admission module wired into the
  parallel-preflight block)
- `packages/cli/src/commands/evidence.ts` (optional `commandMapper` argument
  on `executeAutoEvidencePlan`)
- `package.json` (registered `validate:governance-fix-wave`)
