# Captain Handoff: 2026-06-28 Main Repair Lane

## Goal

Continue from the completed `main` repair and backlog-sync lane, then move into the next ATM CLI / hook / skill-compiler repair wave without re-opening already landed work.

This handoff is for a new captain conversation. It is a continuation summary, not authority transfer.

## Authority Gate For The Next Captain

Before any claim, edit, or governed commit:

1. Run `node atm.mjs identity clear --json` if editor or actor state is uncertain.
2. Set an explicit actor identity:
   `node atm.mjs identity set --actor <new-actor-id> --editor codex --git-name "<git user.name>" --git-email "<git user.email>" --json`
3. Do not inherit repo default identity as authority.

## Current Repository State

- Branch: `main`
- Remote: `origin/main`
- Worktree status at handoff: clean
- Mainline already pushed

Latest relevant commits on `main`:

- `c589f125049ad81adc146f1b78e6a5ee36b8f607`
  `fix: harden ATM identity and skill integration flow`
- `f57dbfe0bdfdf9f939e35400ec346501f4ccb2f3`
  `chore(evidence): backfill git-head for framework repair commit`
- `4a8bf753a16054d60407f8472e148174e9923df8`
  `docs(backlog): sync repaired ATM bug status details`
- `5e1027cf59b98f5beba1cbc7278d5f87e2f19974`
  `docs(backlog): add partial mitigation status for open ATM bugs`

## What Landed Successfully

The main repair lane is already on `origin/main`.

Delivered and verified:

- explicit actor governance hardening
- `identity clear`
- per-actor identity resolution before default identity
- editor/provider mismatch checks
- canonical skill-template handoff gate propagation
- pre-push worktree-local git-head evidence visibility
- validator fixture intermediate layer and schema
- validator duration budget reporting
- non-critical git-head evidence scope narrowing
- backlog repair records synchronized to the landed fixes

Protected push verification already passed on `main`.

## Open Bugs With Updated Current Status

These remain open and should not be accidentally marked fixed:

- `ATM-BUG-2026-06-19-016`
  Residue hygiene is partially improved because non-critical paths no longer generate as much git-head noise, but evidence-only follow-up commits can still briefly re-dirty `git-head.jsonl`.
- `ATM-BUG-2026-06-23-018`
  Frozen runner on `main` now reflects the shipped hook fixes because this lane rebuilt and pushed the release, but source-first framework development still lacks a first-class temporary hook lane.
- `ATM-BUG-2026-06-27-022`
  Backlog prose updates no longer blocked this lane in practice, but there is still no explicit regression proving completion-report detection is path-aware.
- `ATM-BUG-2026-06-27-023`
  Real push flow no longer reproduced the stale git-head evidence failure, but there is still no dedicated parent/child freshness regression.
- `ATM-BUG-2026-06-28-030`
  Skill and entry-template guidance improved, but `next` still emits `prompt-guidance-required` without a concise `playbookAbsent`-style signal.
- `ATM-BUG-2026-06-28-031`
  The lane was unblocked by using the ATM wrapper plus a separate evidence-only follow-up commit, but path-scoped native commit semantics are still not fixed.
- `ATM-BUG-2026-06-28-032`
  Newly recorded. Evidence-only follow-up commits can briefly show `.atm/history/evidence/git-head.jsonl` as modified again after a successful commit, then settle clean.

## Recommended Next Repair Order

Recommended order for the next captain:

1. `ATM-BUG-2026-06-27-022`
   Add a path-aware regression for completion-report detection so governance backlog prose is explicitly safe.
2. `ATM-BUG-2026-06-27-023`
   Add a focused regression for parent/child git-head evidence freshness handoff.
3. `ATM-BUG-2026-06-28-032`
   Determine whether the transient re-dirty comes from hook post-commit behavior or wrapper-side evidence refresh.
4. `ATM-BUG-2026-06-28-031`
   Design or implement path-scoped commit-surface validation / isolated commit lane.
5. `ATM-BUG-2026-06-28-030`
   Tighten CLI/skill contract messaging once the more failure-prone git/hook issues are reduced.

## Useful Files To Inspect First

Core changed sources from the shipped repair:

- `packages/cli/src/commands/hook.ts`
- `packages/cli/src/commands/git-head-evidence.ts`
- `packages/cli/src/commands/git-governance.ts`
- `packages/cli/src/commands/identity.ts`
- `packages/cli/src/commands/actor-registry.ts`
- `packages/integrations-core/src/compiler/compile.ts`
- `packages/integrations-core/src/compiler/skill-templates.ts`
- `scripts/validate-git-hooks-enforcement.ts`
- `scripts/validate-git-head-evidence.ts`
- `scripts/validate-integration-adapter.ts`
- `scripts/run-validators.ts`
- `docs/governance/atm-bug-and-optimization-backlog.md`

## Suggested First Commands For The New Captain

After setting explicit actor identity:

```bash
node atm.mjs next --prompt "Continue the post-main repair lane. Start with ATM-BUG-2026-06-27-022 and ATM-BUG-2026-06-27-023, then inspect ATM-BUG-2026-06-28-032." --json
```

If the captain wants a quick repo-health check before editing:

```bash
node atm.mjs doctor --json
node atm.mjs hook pre-push --json
```

If the captain wants the exact bug list context:

```bash
rg -n "ATM-BUG-2026-06-19-016|ATM-BUG-2026-06-23-018|ATM-BUG-2026-06-27-022|ATM-BUG-2026-06-27-023|ATM-BUG-2026-06-28-030|ATM-BUG-2026-06-28-031|ATM-BUG-2026-06-28-032" docs/governance/atm-bug-and-optimization-backlog.md
```

## Important Notes For Continuation

- Do not re-open the already landed `024` to `029` fixes unless a new regression disproves them.
- Do not describe the current `main` as unmerged or locally only; the repair lane is already pushed.
- Do not assume the evidence-only follow-up residue is harmless until it has explicit regression coverage.
- Keep public framework docs in English.
- Treat CLI JSON as structured ATM output, not prose to reinterpret loosely.
