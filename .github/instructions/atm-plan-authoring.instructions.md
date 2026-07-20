---
applyTo: "**"
---


# ATM Plan Authoring

Use this skill when creating or auditing ATM planning families, plan documents,
or task cards under an external planning repository such as
`docs/ai_atomic_framework`.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
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

This ERR/TMP routing is mandatory. Do not spend GOV numbers on ErrorCode,
error-governance, temporary cleanup, quarantine, or one-off residue-disposition
work. If such work was already drafted under GOV, stop and reclassify it
through the registered planning family before implementation continues.

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

- `INV-ATM-001` ??**No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` ??**Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` ??**Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` ??**No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` ??**Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` ??**Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` ??**Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.
- `INV-ATM-008` ??**Broker tickets, not refusals** (enforcement: `doctor`, breaking change: no)
  Rule: Every governed shared-write gate (runner-sync, build windows, release mirrors, git commit, projection regeneration) must respond with a broker ticket - execute now, enqueue with position, or batch into a shared write window - never a bare refusal. Reads and private writes (own ledger, evidence, task events, lane sessions) never queue. The only standing exceptions are the four owner-ruled cases in docs/governance/parallel-governance-charter.md; any new serialization point requires an explicit project-owner ruling before it ships.
- `INV-ATM-009` ??**Generalized repair and data-driven policy** (enforcement: `doctor`, breaking change: no)
  Rule: Any code logic change, bug fix, or governance rule change must first be designed as the most general rule that correctly explains the observed failure class. Hard-coded special cases are allowed only with recorded evidence that the general rule is not currently safe, feasible, or economical, and that the exception is bounded and reversible. Data-shaped behavior, including thresholds, mappings, allowlists, routing choices, telemetry classifications, prompts, message text, fixtures, and domain content, must first be modeled outside control flow through schemas, registries, configuration, observed counters, or compact digest evidence instead of embedded changeable numbers or strings. The generalized solution must remain observable, testable, and no broader than the evidence supports.

## Guardrails

- Do not create a second task lifecycle or task store.
- Do not register a new series without an approved plan document.
- Do not use an unregistered prefix just because it appears in target ledger
  history.
- Do not move `docs/governance/error-code-registry.json` as part of routine
  family setup.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
