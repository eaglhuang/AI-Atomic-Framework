# Proposal-Gated Write Admission Acceptance Audit

## Scope

This audit maps the current repository state to the CID proposal-gated write admission requirements across `TASK-CID-0115` through `TASK-CID-0119`.

## Core product requirements

### Conditional proposal-first admission

- Requirement:
  proposal-first must apply only to hot files or overlap-risk surfaces; non-risk files must keep the low-friction direct path.
- Current evidence:
  [packages/core/src/broker/team-lane.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/team-lane.ts) derives proposal admission only for the hot-file basename set or when task metadata supplies bounded-region / overlap-risk hints.
- Verification:
  `node --strip-types scripts/validate-team-brokered-write.ts --mode validate`
- Status:
  proved

### First writer provisional / proposal-submitted gate

- Requirement:
  first writer on a hot file must not receive unconditional write authority.
- Current evidence:
  [packages/core/src/broker/team-lane.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/team-lane.ts) blocks `safeToStart` when admission state is `proposal-submitted`; [packages/cli/src/commands/broker.ts](C:/Users/User/AI-Atomic-Framework/packages/cli/src/commands/broker.ts) persists actual admission state into registry status.
- Verification:
  [docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json)
  `traces.firstWriterAdmission.admissionState = proposal-submitted`
- Status:
  proved

### Late joiner rearbitration before apply

- Requirement:
  second writer must be compared against proposal/bounded-region evidence before uncontrolled mutation.
- Current evidence:
  [packages/core/src/broker/decision.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/decision.ts) performs proposal-region overlap arbitration before live apply routing.
- Verification:
  [docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json)
  includes `composer-routed`, `blocked-before-write`, and `parked-for-rearbitration`.
- Status:
  proved

### Park first writer / governed writer handoff

- Requirement:
  first writer can be parked and the late joiner can force rearbitration into a governed path.
- Current evidence:
  [packages/core/src/broker/decision.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/decision.ts) emits `parked-for-rearbitration`; [scripts/validate-team-brokered-write.ts](C:/Users/User/AI-Atomic-Framework/scripts/validate-team-brokered-write.ts) validates the path.
- Verification:
  [docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json)
  `traces.parkedLane.state = parked-for-rearbitration`
- Status:
  proved

### Coherent evidence capture

- Requirement:
  capture/collect pipeline must continue to ingest the new admission states.
- Current evidence:
  [scripts/collect-broker-evidence.ts](C:/Users/User/AI-Atomic-Framework/scripts/collect-broker-evidence.ts) and [scripts/capture-broker-evidence.ts](C:/Users/User/AI-Atomic-Framework/scripts/capture-broker-evidence.ts) now summarize admission state from broker lane and registry-backed proposal-first rows.
- Verification:
  `npm run validate:team-agents -- --case capture-broker-evidence`
  [docs/reports/proposal-gated-write-admission-dogfood/broker-evidence-bundle/broker-evidence-bundle.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/broker-evidence-bundle/broker-evidence-bundle.json)
- Status:
  proved

## Task-card acceptance mapping

### TASK-CID-0116

- Hot-file proposal-submitted without unconditional write authority:
  proved by [docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-summary.json)
- Broker register compares against already submitted proposal state:
  proved by [packages/cli/src/commands/broker.ts](C:/Users/User/AI-Atomic-Framework/packages/cli/src/commands/broker.ts) plus dogfood trace
- Runtime output distinguishes proposal-submitted vs write-admitted:
  proved by broker status admission state and team lane evidence
- Hot-file policy stays selective:
  proved by [packages/core/src/broker/team-lane.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/team-lane.ts)
- Provisional / pre-write admission state exists:
  contract proved in [packages/core/src/broker/types.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/types.ts)
- Early arbitration before second mutation:
  proved by `npm run validate:team-agents -- --case capture-broker-evidence` and `node --strip-types scripts/validate-team-brokered-write.ts --mode validate`

### TASK-CID-0117

- Proposal overlap compare using atom / bounded region hints:
  proved by [packages/core/src/broker/decision.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/decision.ts)
- Same-file different-region early composer route:
  proved by dogfood `composer-routed`
- Same-region early block:
  proved by dogfood `blocked-before-write`
- Parked-first-writer rearbitration:
  proved by dogfood `parked-for-rearbitration`
- Test coverage for early block and early composer route:
  proved by [packages/core/src/broker/__tests__/decision.test.ts](C:/Users/User/AI-Atomic-Framework/packages/core/src/broker/__tests__/decision.test.ts) and [scripts/validate-team-brokered-write.ts](C:/Users/User/AI-Atomic-Framework/scripts/validate-team-brokered-write.ts)

### TASK-CID-0118

- Broker/steward path consumes proposal-gated same-file work:
  proved by [scripts/validate-team-brokered-write.ts](C:/Users/User/AI-Atomic-Framework/scripts/validate-team-brokered-write.ts)
- Same-file composer-routed case ends in applied:
  proved by [docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-hot-apply.json](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-dogfood/proposal-gated-hot-apply.json)
- Collectors report proposal-submitted, composer-routed, applied:
  proved by dogfood bundle JSON plus registry-backed collector row
- Collectors report parked-first-writer rearbitration:
  proved by dogfood summary and collector support code
- Existing schema compatibility:
  proved by schema updates in
  [schemas/team-agents/team-broker-lane.schema.json](C:/Users/User/AI-Atomic-Framework/schemas/team-agents/team-broker-lane.schema.json)
  and
  [schemas/team-agents/team-broker-write-transaction.schema.json](C:/Users/User/AI-Atomic-Framework/schemas/team-agents/team-broker-write-transaction.schema.json)
  together with validator passes

### TASK-CID-0119

- Same-file case captured before second mutation:
  proved by retained dogfood artifact directory
- Hot-file first writer captured before second writer exists:
  proved by `proposal-submitted` trace
- Parked-first-writer trace captured:
  proved by `parked-for-rearbitration` trace
- Composer-routed success captured:
  proved by `composer-routed` plus `applied`
- Blocked-before-write trace captured:
  proved by `blocked-before-write`
- Adoption report states opt-in/default/direct-fast-path boundaries:
  proved by [docs/reports/proposal-gated-write-admission-adoption-gate.md](C:/Users/User/AI-Atomic-Framework/docs/reports/proposal-gated-write-admission-adoption-gate.md)

## Command-backed verification set

- `npm run typecheck`
- `npm run validate:cli`
- `npm run validate:team-agents -- --case capture-broker-evidence`
- `node --strip-types scripts/validate-team-brokered-write.ts --mode validate`
- `node --strip-types scripts/validate-team-brokered-write.ts --mode validate --retain-artifacts-dir docs/reports/proposal-gated-write-admission-dogfood`
- `git diff --check`

## Remaining governance gap

- Product and acceptance evidence are present.
- Final taskflow closeback for the CID cards has not yet been completed in this repository state.
- Because closeback is still open, this audit proves implementation and acceptance evidence, but not yet final governed closure.
