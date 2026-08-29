# Entry Friction Lessons

Use this shard for route selection, claim readiness, and narrowest-lane
materialization problems.

## 2026-06-23 - Imported batch already exists but claim path keeps searching

- Trigger: prompt-scoped SKL batch is already imported into the JSON task ledger
- Symptom: `next --claim` keeps spending time on planning-root discovery or
  extra orchestration instead of converging quickly on the imported queue head
- Correct ATM route: if imported prompt-scoped tasks already exist, trust the
  governed task ledger first and only escalate to planning-root discovery when
  the ledger truly lacks the requested lane
- Durable rule: imported task truth should beat repeated rediscovery
- Backlog link: `ATM-BUG-2026-06-23-019`

## 2026-06-28 - Exact task id resolved, but claim still needs single-card import

- Trigger: `next --task <id>` successfully resolves a planning-repo Markdown
  task card, but `next --claim` fails with
  `ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED`
- Symptom: the agent almost imports the whole planning document, collides with
  unrelated historical task states, and loses time on governance repair before
  the requested card is even claimable
- Correct ATM route: when ATM already identified one exact planning card, import
  that single task card path first; do not widen to the whole plan unless the
  task truly requires synchronized queue materialization
- Durable rule: exact task selection should materialize the smallest claimable
  planning source
