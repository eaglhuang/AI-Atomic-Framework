# @ai-atomic-framework/cli

CLI owns command entrypoints and run envelopes. The skeleton reserves the `atm` binary while later tasks define concrete commands.

Current standalone commands include `bootstrap`, `init`, `self-host-alpha`, `spec`, `status`, `task-view`, `test`, `validate`, and `verify`. Use `task-view --task <id>` for a read-only dashboard over status, evidence blockers, and close completion checklist.