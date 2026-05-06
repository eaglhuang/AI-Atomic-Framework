# ATM Default Profile

Purpose: give any AI agent a model-neutral starter workflow for repositories that do not yet have their own governance layer.

Bootstrap prompt:

{{RECOMMENDED_PROMPT}}

Profile files:

- Project probe: {{PROJECT_PROBE_PATH}}
- Guards: {{DEFAULT_GUARDS_PATH}}
- First task: {{BOOTSTRAP_TASK_PATH}}

Default expectations:

1. Read the host repository README before proposing changes.
2. Respect the detected repository kind `{{REPOSITORY_KIND}}` and host workflow `{{HOST_WORKFLOW}}`.
3. If the package manager is `{{PACKAGE_MANAGER}}`, do not replace it with a different workflow.
4. Keep the first task focused on establishing ATM, proving the probe result, and preserving evidence.