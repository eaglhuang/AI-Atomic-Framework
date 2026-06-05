# BOOTSTRAP-0001 Continuation Summary

Default ATM bootstrap pack created and linked to evidence, context budget, and the next continuation prompt.

- Handoff kind: bootstrap
- Budget decision: pass
- Goal: Resume bootstrap from the generated task, profile, evidence, and budget surfaces.
- Resume prompt: Read README.md if present, then run `node atm.mjs next --prompt "<current user prompt>" --json` from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, `node atm.mjs next --json` is read-only status. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/history/evidence/BOOTSTRAP-0001.json only as supporting runtime state.
- Resume command: node atm.mjs next --prompt <current user prompt> --json

## Next Actions

- Read .atm/history/tasks/BOOTSTRAP-0001.json and .atm/runtime/profile/default.md.
- Run node atm.mjs next --prompt "<current user prompt>" --json, show ATM_USER_NOTICE or evidence.userNotice if present, then execute the returned next action.
- Record the first smoke artifact, log, evidence, and handoff before closing the work item.

## Artifacts

- .atm/history/artifacts
- .atm/history/logs
- .atm/history/reports

## Evidence

- .atm/history/evidence/BOOTSTRAP-0001.json

## Reports

- .atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json
- .atm/history/reports/continuation/BOOTSTRAP-0001.json
