# Initial ATM Context Summary

Bootstrap prompt:

Read README.md if present, then run `node atm.mjs next --prompt "<current user prompt>" --json` from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, `node atm.mjs next --json` is read-only status. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/history/evidence/BOOTSTRAP-0001.json only as supporting runtime state.

Repository kind: generic-repository
Host workflow: manual
Package manager: none

Use this file as the first short handoff summary after the bootstrap task is complete.