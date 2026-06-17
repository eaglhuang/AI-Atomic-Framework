# @ai-atomic-framework/cli

CLI owns command entrypoints and run envelopes. The skeleton reserves the `atm` binary while later tasks define concrete commands.

Current standalone commands include `bootstrap`, `init`, `self-host-alpha`, `spec`, `status`, `task-view`, `test`, `validate`, and `verify`.

## Operator lanes (normal path)

| Command | Role |
|---|---|
| `taskflow open` / `taskflow close` | Governed dual-repo open and closeback. Prefer over backend `tasks close`. |
| `taskflow pre-close` | Read-only blocker summary before `close --write`. |
| `task-view --task <id>` | Read-only dashboard: status triangulation, evidence blockers, close completion checklist, next safe command. |
| `next` | Route the next governed action; do not skip for parallel agents. |
| `git commit --task <id>` | Task-scoped delivery and governance commits with ATM trailers. |

Closeback operator sequence, banned patterns, foreign staged restore, and
checklist fields: `docs/ATM_NEW_USER_WORKFLOW.md` (Closeback operator runbook).
Protected backend surfaces (`tasks repair-closure`, `tasks reconcile`) are
emergency repair only.