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
| ATM product / framework bug | The issue is in ATM CLI, governance lifecycle, Team Agents, task/evidence/lock routing, release runner, integration packs, or ATM docs. | `docs/governance/atm-bug-and-optimization-backlog.items/<ID>.json` in the ATM framework repo |
| Current adopter / app repo bug | The issue is in the user's product repo, app code, game, site, data, content pipeline, or host-specific workflow. | `docs/governance/project-bug-and-optimization-backlog.md` in that repo |
| Cross-repo unclear | The symptom appears in an adopter repo but may be caused by ATM. | Record in the adopter repo first, then add an ATM backlog item only if evidence points to ATM itself |

Do not put non-ATM product bugs into the ATM framework backlog.

## Canonical ATM backlog

ATM backlog authority is item-sharded:

```text
docs/governance/atm-bug-and-optimization-backlog.items/<ATM-BUG-YYYY-MM-DD-NNN>.json
```

The legacy Markdown path remains a generated projection for existing readers:

```text
docs/governance/atm-bug-and-optimization-backlog.md
```

Do not directly author new ATM backlog rows in the Markdown projection. Create or update exactly one item JSON file, then rebuild and validate the projection:

```shell
node --strip-types scripts/validate-governance-projections.ts --write
node --strip-types scripts/validate-governance-projections.ts
```

Do not use `docs/INCIDENT_RESPONSE.md` or `known-bad-versions.json` for ordinary dogfood bugs. Those are only for published release incidents that can cause data loss, corrupt governance state, violate licensing constraints, or ship critical release-trust defects.

## Adopter/project backlog

For non-ATM project bugs, create or update this file in the affected repo:

```text
docs/governance/project-bug-and-optimization-backlog.md
```

If `docs/governance/` does not exist in the affected repo, create it. Keep the backlog local to the repo that owns the bug.

## ATM Item Workflow

1. Identify the affected repo and bug owner.
2. If the owner is ATM, choose the next unused `ATM-BUG-YYYY-MM-DD-NNN` ID by scanning `docs/governance/atm-bug-and-optimization-backlog.items/`.
3. Create or update one JSON item file with schema `atm.governanceBacklogItem.v1`.
4. Keep the item concise and evidence-backed.
5. Run the projection rebuild and validator commands above.
6. Commit the item JSON and generated Markdown projection together when the active task scope owns them.

Each agent should write only its owned item file. The closer or generator rebuilds `docs/governance/atm-bug-and-optimization-backlog.md`.

## ATM Item Schema

Use these fields:

```json
{
  "schemaId": "atm.governanceBacklogItem.v1",
  "id": "ATM-BUG-YYYY-MM-DD-NNN",
  "date": "YYYY-MM-DD",
  "repo": "AI-Atomic-Framework",
  "type": "Bug",
  "severity": "Medium",
  "status": "Open",
  "area": "Governance",
  "finding": "What went wrong.",
  "expectedBehavior": "What should happen instead.",
  "evidenceOrRepro": "Command, task id, commit id, repo path, or observed failure.",
  "followUp": "Proposed task/card/test/owner action."
}
```

Type values:

```text
Bug | Optimization | Documentation / AI routing | Product gap
```

Status values:

```text
Open | Fixed in <task/commit> | Needs task card | Deferred
```

## Entry Guidance

- `Repo`: repository that owns the issue.
- `Finding`: what went wrong.
- `Expected behavior`: what should happen instead.
- `Evidence / Repro`: command, task id, commit id, repo path, or observed failure.
- `Follow-up`: proposed task/card/test/owner action.

When the user asks to 記錄問題 or 寫入 bug 紀錄表, update only the chosen backlog unless they explicitly ask for code fixes.
