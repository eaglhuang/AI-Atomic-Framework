# ATM One-File Release

This artifact is a single-file ATM launcher with embedded payload.

## Entry

`node atm.mjs next --prompt "<current user prompt>" --json`

## Prompt

Read README.md if present, then run "node atm.mjs next --prompt \"<current user prompt>\" --json" from the repository root before task work. Use "node atm.mjs next --json" only as read-only orientation when no user prompt is available. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action.



