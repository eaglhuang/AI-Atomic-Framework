# ATM Captain Audit — Claude-007, 2026-08-08

Status: `NOT COMPLETE / AUDIT IN PROGRESS` (unchanged, but for stronger reasons)
Author: Claude-007. Read-only audit; no matrix row was upgraded.

This document records audit findings only. It does not certify any objective.
Where it disagrees with the 2026-07-31 handoff or the evidence matrix, the
disagreement is stated explicitly with the command or file that proves it.

## 1. Catalog contract findings (ATM-GOV-0313 lane)

### 1.1 ATM-BUG-2026-07-31-012 was misdiagnosed in both directions

The bug report and the first draft of card 0313 stated the defect as "three
`test_atm_gov_` case ids in the commit-attribution shard". A full enumeration of
all case ids against the schema pattern `^(test_int_|test_task_)[A-Za-z0-9_.:-]+$`
shows the real offender set among *reachable* shards is five, in three shards:

| Shard | Invalid caseId |
| --- | --- |
| `test_group_commit_attribution` | `test_broker_apply_admission_before_ref_update` |
| `test_group_commit_attribution` | `test_sealed_commit_dual_lane_prepare_and_broker_finalization` |
| `test_group_commit_attribution` | `test_governed_commit_seal_source_and_provenance_gates` |
| `test_group_plan4_coverage_semantics` | `test_atm_gov_0277_model_relative_certificate_vocabulary_0d0fd68c` |
| `test_group_plan4_obligation_inventory` | `test_atm_gov_0279_obligation_inventory_drift_detector_5c7f6251` |

`test_task_atm_gov_*` ids are schema-VALID. Six such cases exist and are
referenced by the `requiredTestCaseIds` of closed cards. The original ACC-1,
executed literally, would have renamed them and invalidated the sealed closure
evidence of ATM-GOV-0277, 0279, 0280, 0284, 0285 and 0306 to repair a defect
that does not exist. Card 0313's own required case ids are in that same valid
namespace, which is self-contradicting proof the premise was wrong.

Root cause of the miscount: the shard validator asserted per shard and aborted
on the first failure, so only one of three offending shards was ever reported.

### 1.2 ATM-BUG-2026-07-31-013 — full-catalog validator is blind to 42%

Registered as Critical. The 23 shard files under `tests/catalog/groups/` use
FIVE different `schemaId` values. `normalizeGroupShard` accepts only
`atm.testCaseGroup.v1` and returns `null` for the other 11 files with no error,
no warning and no diagnostic.

- 43 total case ids; 25 observed by the validator; **18 never validated**.
- 8 further schema-invalid ids are hiding in the unreachable region.
- They belong to ATM-GOV-0280, 0284, 0285 and **0306**.

ATM-GOV-0306 is load-bearing: the handoff certifies it done/released with all
five closure-required validators fresh, yet both of its `requiredTestCaseIds`
live in `test_group_plan4_mutation_lineage`, which is unreachable. Its closure
packet was produced by a validator that never read its shard.

Containment shipped in 0313: `reportShardReachability` in
`packages/core/src/evidence/test-case-catalog.ts`, plus a frozen shrink-only
register in `tests/cli/plan4-catalog-contract.test.ts` pinning the 11 groupIds
and the total of 18 hidden ids under set equality. The blind spot cannot grow:
any new shard with a non-accepted schemaId fails immediately.

Not repaired here: the 11 shards are sealed deliverables of other closed cards
and the handoff forbids amending the delivered 0306 lane in place. Needs a
dedicated card with explicit authority over them.

## 2. Framework defects discovered while closing 0313

These block every future card that needs an in-flight scope amendment, not just
0313. All three are reproducible.

| # | Defect | Consequence |
| --- | --- | --- |
| 1 | `tasks scope add` writes only `claim.files`. It does NOT update `ledger.scopePaths` (still 17) and does NOT reseal `workAdmissionTicket.grants` (21 vs 27 paths). | Governed commit of legitimately admitted paths fails `ATM_WRITE_TICKET_SCOPE_VIOLATION`. The command ATM's own `requiredAction` tells operators to run is ineffective at the commit boundary. |
| 2 | `ownershipMode: lane-id` mints a NEW lane session per CLI process; the ticket binds the lane at claim time. `lane adopt` succeeds but does not persist across processes. | `tasks renew` / `release` / re-`claim` always return `ATM_TASK_CLAIM_OWNER_MISMATCH`, so the ticket can never be resealed. Combined with #1 this is a hard deadlock. |
| 3 | `ATM_TASK_CLAIM_OWNER_MISMATCH` renders both operands as actorId, which are identical. | Message reads "Task X is claimed by claude-007, not claude-007", hiding the real cause (lane mismatch). Pure operator-time waste. |

Source: `packages/core/src/broker/work-admission-ticket.ts:236-248`,
`packages/cli/src/commands/tasks/claim-ownership.ts:89-114`.

These belong to the `recent-governance-operator-regressions` family owned by
ATM-GOV-0324.

## 3. Plan 3.0 / 3.1 audit

Genuinely complete objectives: **zero**. Plan 3.0 17/17 clauses and Plan 3.1
23/23 clauses remain `not-complete`. The existing matrix verdicts are correct
and must stand.

Highest-value finding — **ATM-GOV-0245's sealed evidence contradicts its own
acceptance criterion**. The card is `done`/closed with a closure packet, but two
of its six validator command runs were executed through `node atm.dev.mjs`
(dev-source runner), not the frozen runner `atm.mjs` that Plan 3.1 §531/§536
require for anything feeding the final verdict. A closed card whose own sealed
evidence violates its acceptance predicate cannot be an input to plan
completion.

ATM-GOV-0234 / 0235 are historical-only. They closed 2026-07-21, ten days before
the current frozen runner was built, so their frozen-worker evidence is against
a runner digest that no longer exists. Reading the task ledger alone (both
`done`) would wrongly imply Plan 3.0 §825/§833 are satisfied.

Most load-bearing missing item: a fresh, frozen-runner-executed, non-superseded
replay of the closure-critical predicate set (0251/0252) bound to the current
frozen runner digest. The matrix declares everything else downstream of it.

## 4. Plan 4.0 readiness and sequencing

All 16 chain cards (0293, 0294, 0305, 0312, 0307, 0287, 0324, 0314-0317,
0318-0322) have ledgers and 3KLife source cards, all `planned`, none claimed.

The dependency topology **agrees** with the prescribed order, with two
corrections:

1. **ATM-GOV-0287 has no unmet predecessor** (0284, 0271 both done). The
   prescribed order places it late, before 0324, but it is claimable in
   parallel from the start. Pulling it earlier is free throughput.
2. **ATM-GOV-0322's real gate is ATM-GOV-0288**, which is `planned` and is not
   a member of the 16-card chain at all. The prescribed order implies 0322
   becomes available after 0318; it does not. This is a hidden blocker that
   will stall the chain at 0322 unless 0288 is sealed first.

Independent of dependency math, **no card is claim-ready today**:
`plan4-phase-readiness-2026-07-31.json` reports `frozenRunner: stale` and
`claimGate: blocked-until-runner-sync` for all 16, and instructs that no phase
card be claimed or built across the active 0313 lane.

ATM-GOV-0308-0311 confirmed reserved-only: no ledger, no planning card, and
zero references in the Plan 4.0 document.

Plan 4.0 sections with no owning card: §4, §5, §6.5-6.6, §7, §9 (distributed
across 0312/0284 only), §15, §16, and §19-§25. The latter are consumed by
0317's certification rather than independently carded, but §7 (state machine /
terminal semantics), §15 and §16 are implementation-bearing and unowned.

## 5. Backlog census

169 open-like items. Only **15 are mapped** to an owning card across four
families (0307, 0313, 0324, 0314/0316/0317). **154 of 169 are unmapped.**

Plan 4.0 §18.4.2 requires every open-like item to be mapped, classified as a
non-confirmed candidate or duplicate, or held under owner-approved exception
before the final verdict. That obligation is currently unmet by a wide margin
and is, in volume terms, the single largest piece of remaining Plan 4.0 work.

## 6. Verdict

`NOT COMPLETE`. The handoff's verdict is correct, but the evidence is worse than
it described: parts of the "current completed boundary" are not merely
unverified, they are affirmatively unsound (0306/0280/0284/0285 via §1.2, and
0245 via §3). No matrix row may be upgraded on the strength of a green
full-catalog validator until ATM-BUG-2026-07-31-013 is closed.
