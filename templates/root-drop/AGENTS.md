# ATM Bootstrap Instructions

This repository uses the default ATM bootstrap pack.

Start with this line:

{{RECOMMENDED_PROMPT}}

Bootstrap files:

- Task: {{BOOTSTRAP_TASK_PATH}}
- Lock: {{BOOTSTRAP_LOCK_PATH}}
- Profile: {{BOOTSTRAP_PROFILE_PATH}}
- Project probe: {{PROJECT_PROBE_PATH}}
- Default guards: {{DEFAULT_GUARDS_PATH}}
- Evidence: {{BOOTSTRAP_EVIDENCE_PATH}}

Operating rules:

1. Keep the host workflow as {{HOST_WORKFLOW}}.
2. Treat the repository kind as {{REPOSITORY_KIND}}.
3. Do not invent a package manager or build step when the probe reports {{PACKAGE_MANAGER}}.
4. Write a short evidence update before finishing the bootstrap task.