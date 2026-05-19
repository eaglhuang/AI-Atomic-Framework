# ATM Default Profile

Purpose: give any AI agent a model-neutral starter workflow for repositories that do not yet have their own governance layer.

Bootstrap prompt:

Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/history/evidence/BOOTSTRAP-0001.json only as supporting runtime state.

Profile files:

- Project probe: .atm/runtime/project-probe.json
- Guards: .atm/runtime/default-guards.json
- First task: .atm/history/tasks/BOOTSTRAP-0001.json

Default expectations:

1. Read the host repository README before proposing changes.
2. Respect the detected repository kind `javascript-package` and host workflow `script-driven`.
3. If the package manager is `npm`, do not replace it with a different workflow.
4. Keep the first task focused on establishing ATM, proving the probe result, and preserving evidence.
