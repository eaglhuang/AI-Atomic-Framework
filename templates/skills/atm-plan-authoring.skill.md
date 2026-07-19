---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-plan-authoring
title: ATM Plan Authoring
summary: Create registered planning families, plan documents, and task cards through the tool-first plan CLI.
command: node atm.mjs plan card create $ARGUMENTS --dry-run --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when creating or auditing ATM planning families, plan documents,
or task cards under an external planning repository such as
`docs/ai_atomic_framework`.

First command:

```bash
{{firstCommand}}
```

## Tool-First Rule

Planning artifacts must be created through the plan CLI:

```bash
node atm.mjs plan doc create --planning-root <planning-root> --family-dir <family-dir> --title "<title>" --doc-name <file.md> --dry-run --json
node atm.mjs plan series register --planning-root <planning-root> --series <key> --prefix <TASK-PREFIX> --family-dir <family-dir> --plan <family-dir>/<file.md> --owner-approved --dry-run --json
node atm.mjs plan card create --planning-root <planning-root> --series <key> --title "<title>" --dry-run --json
```

After the dry-run is correct, repeat the same command with `--write`.

Do not hand-write a new `docs/ai_atomic_framework/<family>/tasks/*.task.md`
file or a new family directory as a substitute for these commands. If the CLI
returns `ATM_PLAN_SERIES_NOT_REGISTERED`,
`ATM_PLAN_SERIES_OWNER_APPROVAL_REQUIRED`, or another structured error, report
that result and the suggested command instead of bypassing the tool.

## Registered Series Model

The registry file is:

```text
<planning-root>/series-registry.json
```

It is the machine-readable source for mapping a task prefix to its family
directory and approved plan documents. Task ids are assigned from the planning
family's `tasks/` directory, not from the target repository's `.atm/history`
ledger.

Use `--series ERR --prefix TASK-ERR` for the error governance family and
`--series TMP --prefix TASK-TMP` for temporary cleanup or quarantine work that
has explicit owner approval. TMP is not a junk drawer; every TMP card must say
why it is temporary and how it will be removed, migrated, or abandoned.

## Error Governance Boundary

The canonical ErrorCode registry currently remains:

```text
docs/governance/error-code-registry.json
```

Future ERR-family work may migrate error governance docs or add a wrapper plan,
but moving the registry itself requires a governed migration that updates
registry readers, `npm run generate:error-codes`, generated `docs/ERROR_CODES.md`,
tests, and every emitter/import path together.

When a plan or task introduces, renames, retires, or explains an `ATM_*` code,
route the code contract through `atm-error-code-resolver`; this skill only owns
planning-family and artifact creation.

## Windows Text IO

On Windows, read, write, and compare Markdown, JSON, and text planning files
with Node.js UTF-8 helpers or the ATM CLI. Do not use PowerShell content
commands for document authoring or content comparison.

## Import Check

After creating a card, verify import routing before implementation:

```bash
node atm.mjs tasks import --from <generated-card.task.md> --dry-run --json
```

The dry-run must discover the intended task id and must not fall back to an
unrelated task.

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Do not create a second task lifecycle or task store.
- Do not register a new series without an approved plan document.
- Do not use an unregistered prefix just because it appears in target ledger
  history.
- Do not move `docs/governance/error-code-registry.json` as part of routine
  family setup.
