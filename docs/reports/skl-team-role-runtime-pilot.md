# SKL Team Role Runtime Pilot

Status: draft
Related tasks: `TASK-SKL-0011`, `TASK-SKL-0012`

This report records the governed `Agent + Skill` runtime pilot used for the SKL
lane. The goal is not to prove that every Team Agent path is production-ready.
The goal is to prove that the role-skill-pack model is concrete enough to:

- describe a realistic role trio;
- preserve Coordinator-only lifecycle authority;
- expose actionable refinement findings when runtime start is still blocked;
- map those findings back to shared growth and role-pack learning references.

## Pilot commands

Source-first validation commands:

```bash
node atm.dev.mjs team plan --task "TASK-SKL-0011" --recipe atm.default.batch --json
node atm.dev.mjs team validate --task "TASK-SKL-0011" --recipe atm.default.batch --json
```

Runtime hygiene companion command:

```bash
node atm.mjs broker cleanup --json
```

Frozen-runner proof rule for CLI / close / taskflow-adjacent changes:

```bash
ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build
node atm.mjs team plan --task "TASK-SKL-0011" --recipe atm.default.batch --json
```

## Observed role trio

The pilot resolves to this bounded trio:

- `coordinator`
- `implementer`
- `validator`

The role-skill-pack mapping is:

- `coordinator -> atm.role-pack.coordinator`
- `implementer -> atm.role-pack.implementer`
- `validator -> atm.role-pack.validator`

## Runtime-pilot signals

`atm.teamRuntimePilot.v1` now surfaces:

- `pilotMode`
- `selectedRoles`
- `selectedSkillPackIds`
- `realisticWorkflow`
- `roleBoundarySignals`
- `lifecycleAuthority`
- `roleConfusionReduction`
- `actionableRefinementFindings`

This keeps the pilot observable even when broker-governed write admission is
still blocked.

## Current outcome

The governed pilot currently shows a realistic role-trio workflow:

1. Coordinator owns route selection and lifecycle.
2. Implementer owns only scoped delivery.
3. Validator owns only validator-evidence interpretation.

`team validate` passes permission-lease checks, which proves the role contract
is internally coherent.

`team plan` still reports a broker-governed blocked state because stale lease
epochs require takeover before conflict arbitration. That blocked state is part
of the pilot evidence, not a reason to collapse back into one oversized skill.

## Why this still counts as useful pilot evidence

- The role pack boundaries are explicit and machine-readable.
- Coordinator-only lifecycle authority is preserved.
- The blocked state is observable as role-specific friction rather than hidden
  inside generic failure text.
- The refinement finding routes directly into
  `docs/governance/team-agents/role-pack-learning-loop.md`.

## Follow-up

- Keep the role-pack observability surface active for `TASK-SKL-0012`.
- Build the frozen runner with retained release artifacts before claiming
  frozen-runner proof for these new team surfaces.
- Treat stale broker lease/takeover cleanup as product follow-up, while keeping
  the operator lesson in active growth references until the product fix is
  stable.
