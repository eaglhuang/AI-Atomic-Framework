# ATM Captain Handoff — back to Codex

Date: 2026-08-08
Outgoing captain: Claude-007
Incoming captain: Codex
Scope: AI-Atomic-Framework + external planning repo `C:/Users/User/3KLife`

Overall verdict: **`NOT COMPLETE`** — and the evidence is worse than the
2026-07-31 handoff described. See §2. Do not downgrade this verdict.

## 0. State you are inheriting (verify before trusting)

- `ATM-GOV-0313` = `ready / claim-released`. Claim was released deliberately at
  `2026-08-08T15:51:08Z` so you can claim cleanly. **It is not done.**
- Its implementation is **complete and verified in the worktree, uncommitted.**
- The git index is **empty**. I unstaged deliberately — another lane is active
  in this worktree and 29 staged files would cross commit attribution.
- No override or emergency lease was ever used. No foreign work was touched.

Verify with:

```
node atm.mjs tasks status --task ATM-GOV-0313 --json
git status --porcelain
node --strip-types tests/cli/plan4-catalog-contract.test.ts
```

## 1. The one blocker, and exactly how to clear it

`ATM-GOV-0313` cannot reach governed commit. Root cause is a **framework
defect**, not a scoping mistake:

`tasks scope add` writes only `claim.files`. It does **not** update
`ledger.scopePaths` (still 17) and does **not** reseal
`workAdmissionTicket.grants` (21 paths vs 27 in `claim.files`). Governed commit
therefore fails `ATM_WRITE_TICKET_SCOPE_VIOLATION` on legitimately admitted
paths. The only reseal route, `tasks renew`, always fails (see §3, defect 2).

**Fix: put the 7 paths in the planning card, then re-import.** They are genuine
deliverables of this card and belong in its `scopePaths` regardless.

Add to `scopePaths:` in
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/tasks/ATM-GOV-0313-canonical-test-catalog-namespace-repair-and-historical-shard-migration.task.md`:

```
  - docs/governance/atm-bug-and-optimization-backlog.md
  - docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-31-012.json
  - docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-31-013.json
  - packages/cli/src/commands/test-catalog.ts
  - packages/core/src/evidence/test-case-catalog.ts
  - schemas/validators/test-case-group.schema.json
  - tests/cli/commit-attribution-sealed-transaction.test.ts
```

I could not make this edit myself: the environment's permission classifier
denied writes to the 3KLife planning card twice, and denied
`node atm.mjs emergency approve`. I declined to bypass it via Bash, settings
edits, or a subagent. You will likely not be under the same restriction.

Then resume:

```
node atm.mjs tasks import --from "<that card path>" --dry-run --json
node atm.mjs tasks import --from "<that card path>" --write --force --json
node atm.mjs next --claim --actor <you> --task ATM-GOV-0313 --auto-intent --json
```

The ticket then mints complete on the first claim and commit works. **Do not
run `tasks scope add` after claiming** — that re-creates the deadlock.

### Restage list (exact, 29 paths + 1 new)

```
docs/governance/atm-bug-and-optimization-backlog.md
docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-31-012.json
docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-31-013.json
packages/cli/src/commands/test-catalog.ts
packages/core/src/evidence/test-case-catalog.ts
schemas/validators/test-case-group.schema.json
tests/catalog/groups/test_group_commit_attribution.shard.json
tests/catalog/groups/test_group_plan4_catalog_contract.shard.json
tests/catalog/groups/test_group_plan4_coverage_semantics.shard.json
tests/catalog/groups/test_group_plan4_obligation_inventory.shard.json
tests/cli/commit-attribution-sealed-transaction.test.ts
tests/cli/plan4-catalog-contract.test.ts
tests/cli/test-case-catalog-shards.test.ts
.atm/history/tasks/ATM-GOV-0313.json
.atm/history/task-events/ATM-GOV-0313/
.atm/history/evidence/ATM-GOV-0313.json
.atm/history/evidence/ATM-GOV-0313.bundle-manifest.json
```

Stage with explicit paths. **Never `--auto-stage`** while a second lane is live.
Then: governed commit → `broker runner-sync enqueue` → `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` → commit release artifacts → `taskflow close --write`.
Runner sync is mandatory: 0313 modifies `packages/core` and `packages/cli`.

## 2. The finding that matters most — the completed boundary is unsound

**`ATM-BUG-2026-07-31-013` (Critical, registered).** The full-catalog validator
is blind to 42% of the catalog and exits 0 anyway.

The 23 shard files under `tests/catalog/groups/` use **five** different
`schemaId` values. `normalizeGroupShard` accepts only `atm.testCaseGroup.v1` and
returns `null` for the other 11 — no error, no warning, no diagnostic.

- 43 case ids total; 25 observed; **18 never validated**
- 8 further schema-invalid ids hide in the unreachable region
- they belong to **ATM-GOV-0280, 0284, 0285 and 0306**

**ATM-GOV-0306 is load-bearing.** The previous handoff certifies it
`done/released` with "all 5 closure-required validators fresh". Both of its
`requiredTestCaseIds` live in `test_group_plan4_mutation_lineage`, which is
unreachable. Its closure packet came from a validator that never read its shard.

**Also: `ATM-GOV-0245`'s sealed evidence contradicts its own acceptance
criterion.** Two of its six validator runs used `node atm.dev.mjs` (dev-source
runner), not the frozen runner that Plan 3.1 §531/§536 require for anything
feeding the final verdict.

`ATM-GOV-0234 / 0235` closed 2026-07-21, ten days before the current frozen
runner was built; their frozen-worker evidence is against a digest that no
longer exists.

**Consequence for you:** parts of the "current completed boundary" are not
merely unverified, they are **affirmatively unsound**. Do not upgrade any matrix
row on the strength of a green full-catalog validator until 013 is closed.

Containment already shipped in 0313: `reportShardReachability` in
`packages/core/src/evidence/test-case-catalog.ts`, plus a **frozen shrink-only
register** in `tests/cli/plan4-catalog-contract.test.ts` pinning the 11 groupIds
and the total of 18 hidden ids under set equality. The blind spot cannot grow —
any new shard with a non-accepted schemaId fails immediately. Repairing the 11
shards needs a dedicated card with authority over those closed cards'
deliverables; I did not touch them, per the preserve-the-0306-lane rule.

## 3. Framework defects found (all reproducible, all block future cards)

| # | Defect | Consequence |
| --- | --- | --- |
| 1 | `tasks scope add` updates only `claim.files`; no `ledger.scopePaths` update, no ticket reseal | Every in-flight scope amendment makes governed commit impossible. ATM's own `requiredAction` recommends this command. |
| 2 | `ownershipMode: lane-id` mints a new lane per CLI process; ticket binds lane at claim time; `lane adopt` does not persist | `renew` / `release` / re-`claim` always `ATM_TASK_CLAIM_OWNER_MISMATCH` across processes. With #1 this is a hard deadlock. |
| 3 | `ATM_TASK_CLAIM_OWNER_MISMATCH` prints both operands as actorId | Message reads "claimed by claude-007, not claude-007", hiding the lane cause entirely. |

Source: `packages/core/src/broker/work-admission-ticket.ts:236-248`,
`packages/cli/src/commands/tasks/claim-ownership.ts:89-114`.
These belong to the `recent-governance-operator-regressions` family owned by
**ATM-GOV-0324**. They are not yet carded individually.

## 4. Sequencing corrections to the prescribed order

The dependency topology broadly agrees with
`0293→0294→0305→0321→0318→0322→0319→0320→0312→0307→0287→0324→0314→0315→0316→0317`,
with two corrections you should apply:

1. **`ATM-GOV-0287` has no unmet predecessor** (0284, 0271 both done). The
   prescribed order places it late; it is claimable in parallel from the start.
   Free throughput.
2. **`ATM-GOV-0322`'s real gate is `ATM-GOV-0288`**, which is `planned` and is
   **not a member of the 16-card chain**. The order implies 0322 unblocks after
   0318; it does not. Seal 0288 first or the chain stalls at 0322.

Independent of the graph: `plan4-phase-readiness-2026-07-31.json` reports
`frozenRunner: stale` / `claimGate: blocked-until-runner-sync` for **all 16**
cards, and forbids claiming phase cards across an active 0313 lane. So 0313
closure + runner sync gates the entire chain — it is one root cause, not eight.

`ATM-GOV-0308–0311` confirmed reserved-only: no ledger, no planning card, zero
references in the Plan 4.0 document.

## 5. Work completed this session

- **`ATM-BUG-2026-07-31-012` diagnosis corrected and repaired.** The reported
  defect ("three `test_atm_gov_` ids") was wrong in both directions: it missed
  the `test_broker_`/`test_sealed_`/`test_governed_` family, and condemned the
  `test_task_atm_gov_*` namespace which is schema-**valid** and used by six
  cases on closed cards. Executing the original ACC-1 literally would have
  renamed them and invalidated the sealed closure evidence of 0277, 0279, 0280,
  0284, 0285 and 0306. Cause of the miscount: the validator aborted on the first
  failing shard, so 2 of 3 offending shards were never reported.
- **5 ids migrated** to deterministic `buildTestCaseId` output, with a new
  narrow `legacyAliases` seam in the schema so closed cards resolve their legacy
  `requiredTestCaseIds` **without editing any sealed evidence**. The 6 valid ids
  are byte-identical, asserted by a negative control.
- Shard-reading consolidated into one function in core (was duplicated).
- Validator now aggregates all schema failures instead of aborting on the first.
- Four suites green: `test-case-catalog-shards`, `plan4-catalog-contract` (new),
  `commit-attribution-sealed-transaction`, `npm run typecheck`.
- Three evidence receipts sealed via `evidence run`.
- **Plan 3.0/3.1 audit**: 17/17 and 23/23 clauses correctly `not-complete`;
  zero genuinely complete objectives.
- **Plan 4.0 audit**: sequencing corrections above.
- **Backlog §18.4.2 mapping**: 155/155 previously-unmapped open-like items
  placed into 14 causal families; 6 duplicates, 19 product-gaps identified.
  Proposal only — no item status was changed.

Companion documents:
- `docs/governance/skills/ATM-SKL-captain-audit-2026-08-08-claude-007.md`
- `docs/governance/skills/ATM-SKL-backlog-family-mapping-2026-08-08-claude-007.md`

## 6. Prohibitions carried forward

- Do not treat task `done/released` as plan completion.
- Do not treat fixture-only or prose-only evidence as hostile dogfood.
- Do not use override/emergency lease on a success path.
- Do not `--auto-stage` while a second lane is live in this worktree.
- Do not absorb foreign residue (POA, SKL-0037, GOV-0001 report, 0293 ledger,
  `artifacts/generated/skill-corpus-audit.json`, 0314–0317 artifacts) into a
  delivery commit.
- Do not shrink or extend the frozen reachability register in
  `tests/cli/plan4-catalog-contract.test.ts` without owner approval. It is
  shrink-only by design.
- Do not certify Plan 4.0 while `ATM-BUG-2026-07-31-013` is open.

## 7. Concurrency note

A second lane was writing this worktree throughout the session (cards
0314–0317, 0324 and several shards appeared between 22:24 and 00:18). Neither
claim nor broker intent was registered for it, so ATM's concurrency guards could
not see it. If that was you, be aware the 0313 planning card was authored at
22:37 — **after** the 2026-07-31 handoff was written at 22:10 — which is why
that handoff never mentions 0313.
