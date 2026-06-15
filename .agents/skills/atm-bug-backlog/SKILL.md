---
name: atm-bug-backlog
description: Record bugs, dogfood failures, workflow friction, and optimization ideas into the correct repository-specific backlog. Use when the user says bug backlog, bug record, bug log, optimization backlog, bug 紀錄表, 優化事項, encountered bug, dogfood issue, ATM Bug and Optimization Backlog, or asks to write down problems found during ATM, Team Agents, or adopter project work.
---

# ATM Bug Backlog Router

Use this skill to record bugs and optimization items in the right backlog for the right repository.

## First decision: what owns the bug?

Classify before writing:

| Classification | Use when | Backlog path |
| --- | --- | --- |
| ATM product / framework bug | The issue is in ATM CLI, governance lifecycle, Team Agents, task/evidence/lock routing, release runner, integration packs, or ATM docs. | `docs/governance/atm-bug-and-optimization-backlog.md` in the ATM framework repo |
| Current adopter / app repo bug | The issue is in the user's product repo, app code, game, site, data, content pipeline, or host-specific workflow. | `docs/governance/project-bug-and-optimization-backlog.md` in that repo |
| Cross-repo unclear | The symptom appears in an adopter repo but may be caused by ATM. | Record in the adopter repo first, then add an ATM backlog row only if evidence points to ATM itself |

Do not put non-ATM product bugs into the ATM framework backlog.

## Canonical ATM backlog

```text
docs/governance/atm-bug-and-optimization-backlog.md
```

Do not use `docs/INCIDENT_RESPONSE.md` or `known-bad-versions.json` for ordinary dogfood bugs. Those are only for published release incidents that can cause data loss, corrupt governance state, violate licensing constraints, or ship critical release-trust defects.

## Adopter/project backlog

For non-ATM project bugs, create or update this file in the affected repo:

```text
docs/governance/project-bug-and-optimization-backlog.md
```

If `docs/governance/` does not exist in the affected repo, create it. Keep the backlog local to the repo that owns the bug.

## Workflow

1. Identify the affected repo and bug owner.
2. Choose the backlog path from the classification table.
3. Read the chosen backlog if it exists.
4. If it does not exist, create it with a title and the standard table.
5. Add one row per distinct bug or optimization.
6. Prefer concise, evidence-backed entries over long narratives.
7. Include enough reproduction context that a later task card can be created without reading the full chat.
8. If the failure was caused by poor discoverability of this skill or backlog, add an ATM backlog item for discoverability.

## Standard table columns

Use these columns:

```markdown
| ID | Date | Repo | Type | Severity | Status | Area | Finding | Expected behavior | Evidence / Repro | Follow-up |
```

ID formats:

```text
ATM-BUG-YYYY-MM-DD-NNN
PROJECT-BUG-YYYY-MM-DD-NNN
```

Type values:

```text
Bug | Optimization | Documentation / AI routing | Product gap
```

Status values:

```text
Open | Fixed in <task/commit> | Needs task card | Deferred
```

## Entry guidance

- `Repo`: repository that owns the issue.
- `Finding`: what went wrong.
- `Expected behavior`: what should happen instead.
- `Evidence / Repro`: command, task id, commit id, repo path, or observed failure.
- `Follow-up`: proposed task/card/test/owner action.

When the user asks to "順手記下" or "補到 bug 紀錄表", update only the chosen backlog unless they explicitly ask for code fixes.
