
# Mailbox Worker Execution

Use this skill for worker intake threads that receive or claim mailbox dispatch
cards from a captain, broker, or Team Agents lane.

The worker's job is not to acknowledge the card. The worker's job is to read the
card fully, complete the required scoped work, run required validators or
checks, and only then report completion. If the required work cannot be finished,
report a blocker honestly.

## Actor Identity Handoff Gate

Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,
or governed `git ...` command, resolve this agent's explicit actor id.

- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.
- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.
- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.
- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.

## Worker Intake Rule

Before claiming a dispatch, identify the worker actor id for this editor/thread.
If this worker is taking over a reused editor, reused worktree, or previous
agent's mailbox, clear stale default identity first and set the worker's own
actor-scoped identity.

Do not inherit the captain's identity. Do not use a repo default identity as
permission to claim, edit, close, report, or commit.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

After every `next --prompt` or `next --claim` response, read
`evidence.nextAction.playbook` before editing, closing, or committing.

## Core Rule

Treat the active dispatch card as the authority. Follow its scope, deliverables,
validators, report contract, and write boundary.

## Completion Rule

Report completion only when the required work is actually finished. Do not mark
done merely because the card was read, claimed, one command was run, one check
passed, or a report body was drafted.

If uncertain whether the card is complete, the safe default is to report what
remains and mark the work blocked or partial instead of done.

## Report Rule

When work is complete, include command-backed evidence when required, list what
changed, and state validator PASS/FAIL clearly. Do not send thin reports such as
`ok`, `done`, or `PASS` without details.

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

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

## Rules

- Use ATM as the only governance route for this action.
- Do not create a second registry, task state, or approval workflow.
- Preserve user-edited integration files; manifest hashes decide uninstall safety.
