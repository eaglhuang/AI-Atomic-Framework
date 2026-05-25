# AAO Task Index

Related plan: `docs/ai_atomic_framework/atm-agent-first-operability/AAO-Plan.md`

| Task ID | Title | Milestone | Status | Depends | Surface | Routed Existing Work |
|---|---|---|---|---|---|---|
| `TASK-AAO-0000` | AAO file mirror and ASA bridge index | M0 | done | none | docs | none |
| `TASK-AAO-0001` | Report overlap matrix and route decisions | M1 | open | `TASK-AAO-0000` | docs / analysis | `TASK-ATD-0023`, `TASK-ATD-0032` |
| `TASK-AAO-0002` | CLI command spec / runner SSOT drift guard | M1 | open | `TASK-AAO-0001`, `TASK-ASA-0009` | CLI surface | none |
| `TASK-AAO-0003` | `next` decisionTrail JSON contract | M1 | open | `TASK-AAO-0001`, `TASK-ASA-0009` | CLI JSON | none |
| `TASK-AAO-0004` | validator failure envelope standardization | M2 | open | `TASK-AAO-0001`, `TASK-ASA-0010` | validators | none |
| `TASK-AAO-0005` | CLI context slimming wave 1 | M2 | open | `TASK-AAO-0002`, `TASK-AAO-0003`, `TASK-ASA-0009` | `tasks.ts`, `next.ts` | none |
| `TASK-AAO-0006` | docs / schema / command drift guard | M3 | open | `TASK-AAO-0002`, `TASK-AAO-0004`, `TASK-ASA-0010`, `TASK-ASA-0014` | docs / schema | none |
| `TASK-AAO-0007` | onefile size / startup budget | M3 | open | `TASK-AAO-0001`, `TASK-ASA-0014`, `TASK-ATD-0025`, `TASK-ATD-0032` | release / onefile | `TASK-ATD-0025`, `TASK-ATD-0032` |
| `TASK-AAO-0008` | AAO roadmap backwrite and ASA bridge closure | M4 | open | `TASK-AAO-0005`, `TASK-AAO-0006`, `TASK-AAO-0007` | docs / bridge | `TASK-ASA-*` |

## Bridge Notes

- `TASK-ATD-0023` already owns the `any` debt budget.
- `TASK-ATD-0032` already owns root-drop sandbox E2E.
- AAO should not reopen those concerns here; it should only reference them in route notes and acceptance.
