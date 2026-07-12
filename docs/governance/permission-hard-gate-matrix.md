# Permission Hard-Gate Matrix

ATM team permissions are fail-closed. A permission is usable only when it is present in the governed catalog, assigned to an allowed actor, and its scope requirements are satisfied. Unknown permissions and missing required scope are hard failures.

| Permission family | Gate | Scope rule | Ownership rule |
| --- | --- | --- | --- |
| `task.lifecycle`, `git.write`, `evidence.write` | `ATM_TEAM_PERMISSION_HARD_GATE` | Task/run boundary | Coordinator-only, exclusive |
| `file.read`, `exec.validator`, `knowledge.query` | `ATM_TEAM_PERMISSION_HARD_GATE` | Explicit paths for file/exec leases | Shareable where catalog allows |
| `file.write`, `web.download`, `exec.mutating`, `pipeline.write`, `database.write`, `ci.write`, `knowledge.index.write` | `ATM_TEAM_PERMISSION_HARD_GATE` | Explicit paths required and checked against task scope where applicable | Exclusive |
| `web.query`, `sandbox.write`, `review.signature.write` | `ATM_TEAM_PERMISSION_HARD_GATE` | Run/task boundary; no implicit elevation | Exclusive |

The hard gate is enforced at recipe validation, team lease/release mutation, provider execution permission brokerage, and the existing task/emergency governance paths. Host controls such as Git hooks, CI, branch protection, and review policy remain additional deployment-layer gates; they do not replace ATM's internal gate.

| `handoff.materialize` | `ATM_TEAM_PERMISSION_HARD_GATE` | Exact task/run and runtime-bound Coordinator actor | Exclusive; Provider bridges and workers are denied. |
| `handoff.read` | `ATM_TEAM_PERMISSION_HARD_GATE` | Exact task/run and runtime-bound Coordinator actor; continuation additionally requires same-task terminal prior run | Shareable only through the Coordinator context builder; providers never read history directly. |

Both handoff gates are fail-closed. Integrity failures resolve to the canonical
`handoff-integrity-blocked` reason and do not degrade to advisory Markdown.
