# ATM Antigravity Onboarding

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

Antigravity adapter entry routes through `GEMINI.md` and delegates detailed command skills to `.agents/skills/atm-*/SKILL.md`.

If governance-router friction appears, do not load a monolithic lesson log.
Read `.agents/skills/atm-governance-router/references/index.md` first, then
open only the single matching shard.

After every `next --prompt` or `next --claim` response, read `evidence.nextAction.playbook` before editing, closing, or committing. The playbook is the channel-specific work order.

Batch requests must stay in batch: claim the original prompt, deliver only the current queue head, add command-backed evidence, run `node atm.mjs batch checkpoint --actor <id> --json`, then commit only after checkpoint succeeds.

Do not manually loop over `tasks reserve`, `tasks promote`, `tasks claim`, or `tasks close`; do not commit before `batch checkpoint` during an active batch.

## Skill Directory

- `.agents/skills/atm-next/SKILL.md`
- `.agents/skills/atm-orient/SKILL.md`
- `.agents/skills/atm-governance-router/SKILL.md`
- `.agents/skills/atm-create/SKILL.md`
- `.agents/skills/atm-lock/SKILL.md`
- `.agents/skills/atm-evidence/SKILL.md`
- `.agents/skills/atm-upgrade-scan/SKILL.md`
- `.agents/skills/atm-handoff/SKILL.md`
- `.agents/skills/atm-atom-map-refactor/SKILL.md`

## Charter Invariants

- `INV-ATM-001` — **No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` — **Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` — **Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` — **No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` — **Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` — **Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` — **Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.

## Notes

- Antigravity differs from the Gemini CLI adapter: it uses `GEMINI.md` as the primary entry and `.agents/skills` for ATM command skills.
- Governance logic stays in ATM CLI; this adapter only provides host-native entry files.
