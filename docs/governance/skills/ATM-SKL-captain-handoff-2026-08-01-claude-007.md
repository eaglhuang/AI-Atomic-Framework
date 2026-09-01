# ATM Captain Handoff — Claude-007

Date: 2026-07-31
Outgoing captain: codex
Incoming captain: Claude-007
Scope: AI-Atomic-Framework + external planning repo `C:/Users/User/3KLife`

Latest document amendment: 2026-08-08T21:47:35+08:00. Plan 4.0 §18.4.1,
the four-plan evidence matrix, and this handoff were reconciled so the same
seven incident families and the catalog-contract blocker are named everywhere;
ATM-GOV-0313 was created/imported as planned and is now live-ledger `running`
under Claude-007 while its planning mirror remains `planned`. This amendment is documentation
and planning state only and does not change any implementation or completion
verdict. ATM-GOV-0285 and ATM-GOV-0306 are independently verified
done/released; the 0314 dependency omission was corrected in source and target
ledger, and the phase-readiness ledger now publishes the authoritative
topological order. The runner remains stale for implementation evidence and
the overall verdict remains not-complete.

The audit now records the first-principles order explicitly: stabilize catalog
identity (0313), finish dependency/coverage contracts and close the operator
regression owner card (0293/0294/0305/0312/0307/0287/0324),
prove selected-versus-full policy and adapter parity (0314/0315), run hostile
dual-captain dogfood (0316), then certify all four plans and retire legacy
authority reversibly (0317). A missing, stale, ambiguous, or unsupported
observation preserves the prior authority and cannot be waived into pass.

Dependency consistency correction: Plan 4.0's proposed 0278/0286/0295/0301/
0304 were formalized as registered cards 0321/0318/0322/0319/0320. 0312's
target ledger now matches the registered 0318/0319/0320 dependencies. The
structural-coverage prerequisite ATM-GOV-0288 is now formally registered with
target ledger and fidelity-checked import evidence. The remaining previously
proposed Plan 4.0 cards are also now registered: ATM-GOV-0281, ATM-GOV-0282,
ATM-GOV-0283, ATM-GOV-0287, ATM-GOV-0289, ATM-GOV-0290, ATM-GOV-0291,
ATM-GOV-0296, ATM-GOV-0297, ATM-GOV-0298, ATM-GOV-0299, ATM-GOV-0300,
ATM-GOV-0302, and ATM-GOV-0303. Together
with 0288 and replacements 0318/0319/0320/0321/0322, all are planned/no-claim
and unimplemented. 0322 must wait for 0288 sealed evidence; downstream
generators and phase exit must wait for their declared hard edges. Registration
is not completion and no dependency may be waived.
The refreshed census also records the unresolved operator regression cluster
`ATM-BUG-2026-07-31-002` through `ATM-BUG-2026-07-31-008` (ticket authority, record-commit parity, dry-run mutation,
runner-sync publication, import attribution, and close status receipts) with
no completed repair evidence. This cluster is an explicit Plan 4.0
final-verdict blocker; it must be completed through its registered owner card
and fresh evidence, not silently absorbed into the seven incident families.
It is now represented by `ATM-GOV-0324` (planned/no-claim), dependent on
0307/0287 and required by 0317. Implementing 0324 remains mandatory; the card
registration is not a bug fix or completion proof.
Registered source cards and target ledgers now exist for 0318, 0319, and 0320;
their import evidence is under `.atm/history/reports/task-import/` and each
ledger has `status=planned`, `claim=null`, and `frontmatterFidelity.ok=true`.
Their validators and deliverables are contracts only; no implementation or
fresh evidence is implied.

The machine-readable four-plan audit ledger is
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan-3x-4x-objective-audit-2026-07-31.json`.
The reproducible input snapshot is
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan-3x-4x-audit-snapshot-2026-07-31.json`.
The executable per-plan exit checklist is
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan-3x-4x-execution-checklist-2026-08-08.md`.
Its clause/section mapping is complete, but its objective verdict remains
`not-complete`; Claude-007 must update it only after fresh evidence proves each
objective and the deep-module gate.
The audit ledger now carries a machine-readable `objectiveEvidenceTuple`: every
clause requires source digest, owner card, required tests, validator receipt,
sealed delivery provenance, rollback/fail-closed proof, deep-module review,
real dogfood observation, bug disposition, and release/push provenance. Any
null, stale, fixture-only, or prose-only field keeps that row unresolved.
The `2026-08-08T21:47:35+08:00` read-only recheck found all 42 Plan 4 GOV
references present in target ledgers with no dependency gap or cycle, but 0313
is still the sole active lane and the frozen runner is stale. Treat this as
structural readiness only, not implementation or completion evidence.

The same recheck confirmed `broker status` has zero active intents and
`batch status` has no active batch or pending commit. That is a coordination
snapshot, not proof that parallel-dogfood objectives passed. The frozen runner
still reports `ATM_RUNNER_SYNC_REQUIRED`; no phase card may claim implementation
or acceptance evidence until source/frozen parity is rebuilt and sealed.

Execution handoff gate: after 0313 releases, the incoming captain must first
re-run the exact full catalog command and seal its evidence, then execute the
registered dependency order. `ATM-GOV-0324` is now the explicit owner of the
002..008 operator-regression family and must complete before 0317; its card
existence does not close the incidents. Only 0317 may issue the overall verdict,
and it must report four separate dimensions: objective proof, task/card state,
incident/backlog disposition, and release/push provenance.

Safe parallel frontiers for the next captain (only after the listed
dependencies are sealed, and never across a shared file without broker
admission):

| Frontier | Allowed work | Must remain serialized behind |
|---|---|---|
| Catalog authority | 0313 implementation and its historical-shard migration | the active 0313 lane; no mirror repair or second catalog editor |
| Operator closure | 0324 once 0307/0287 evidence exists | 0313 only where catalog evidence is consumed; otherwise separate scope |
| Coverage/contract chain | 0293/0294/0305 and the 0321/0318/0322/0319/0320 family | their declared dependency edges; no shared `evidence/index.ts` edit without broker admission |
| Phase validation | 0314 then 0315 | 0312 and TASK-SKL-0037 evidence; do not start 0316 early |
| Hostile dogfood | 0316 | 0315, runner parity, and all mandatory prerequisite receipts |

Parallel means independent sealed preparation only. Final delivery, runner
publication, close, and any shared-surface mutation remain broker/CAS governed;
an empty queue or an unclaimed card is not evidence that a lane is safe to
override.

Snapshot amendment: 2026-07-31T23:02:00+08:00. This records the live
ATM-GOV-0313 claim and the hashes used for the current audit inputs.

Snapshot amendment: 2026-07-31T23:05:00+08:00; the input snapshot was refreshed
after the matrix live-lane rule update.

Live-lane rule: `tasks status --task ATM-GOV-0313 --json` reports the live
ledger as `running/active` for `claude-007`, while the planning mirror is still
`planned`. Treat the live ledger as SSOT during this claim; do not run import,
force, reset, or mirror reconciliation against 0313 until its lane is released.
Latest 0313 scope amendment (linked-surface):
`schemas/validators/test-case-group.schema.json`,
`packages/cli/src/commands/test-catalog.ts`, and
`tests/cli/commit-attribution-sealed-transaction.test.ts`. The reason is that
ACC-2 alias lineage cannot be represented by the current canonical case-id
pattern; the repair must add a narrow `legacyAliases` seam, preserve canonical
identity validation, and prove resolver/load behavior with regression evidence.
The full catalog gate is still red: running
`node --strip-types tests/cli/test-case-catalog-shards.test.ts` fails with
`shard test_group_commit_attribution must validate`. Do not treat the valid
0313 scaffold shard as catalog-wide success; the historical shard migration,
alias lineage, and this exact full command must all be green.
The alias-lineage/schema mismatch is a confirmed framework defect class, but a
separate backlog item was deliberately not created while 0313's active lane
owns the adjacent backlog projection. After 0313 releases, either amend its
owned bug item or create the next unused `ATM-BUG-2026-07-31-NNN` item through
the bug-backlog workflow; do not silently drop this finding from the Plan 4.0
census.

## Executive state

## Phase-card renumbering amendment (2026-07-31T23:10:00+08:00)

The Plan 4.0 phase cards formerly labelled 0308–0311 were unavailable because
the registered GOV allocator assigned 0312 and 0313 first. They are now
represented by the following imported planned cards; this mapping supersedes
older “reserved/missing” wording below:

| Plan 4 role | Current card | Status | Dependency order |
|---|---|---|---|
| selected-versus-full shadow | ATM-GOV-0314 | planned | 0294, 0305, 0312, TASK-SKL-0037 |
| six-editor adapter parity | ATM-GOV-0315 | planned | 0314 |
| hostile dual-captain dogfood / phase exit | ATM-GOV-0316 | planned | 0315 |
| four-plan certification / legacy retirement | ATM-GOV-0317 | planned | 0316 |

All four imports passed frontmatter fidelity dry-run and write. Their card
existence is not implementation evidence; each still requires fresh tests,
sealed delivery, rollback, and deep-module receipts. Claude-007 must use the
current IDs and ignore stale 0308–0311 references in older prose.

Each card now has two required test IDs and a dedicated catalog shard:
`test_group_plan4_shadow_comparison`, `test_group_plan4_adapter_parity`,
`test_group_plan4_hostile_dogfood`, and `test_group_plan4_final_certification`.
The latest target import evidence is respectively:
`15-10-13-823Z`, `15-10-28-996Z`, `15-10-42-487Z`, and `15-10-57-251Z` under
`.atm/history/reports/task-import/`. These are contract/import evidence only;
the focused test files do not yet exist and must be created by the owning lane.
After adding evidence/rollback frontmatter, the latest reconcile evidence is
`15-22-25-637Z` (0314), `15-19-28-697Z` (0315), `15-19-45-315Z` (0316), and
`15-19-56-018Z` (0317). All four report `frontmatterFidelity.ok=true`; 0314's
target dependencies now explicitly include 0294, 0305, 0312, and TASK-SKL-0037.
Operational lookup:

| Card | Required test IDs |
|---|---|
| 0314 | `test_task_atm_gov_0314_shadow_comparison_2a6f9d41`, `test_task_atm_gov_0314_shadow_adjudication_7c1b4e92` |
| 0315 | `test_task_atm_gov_0315_adapter_parity_4d8a1c73`, `test_task_atm_gov_0315_adapter_reinstall_smoke_9e2b6f14` |
| 0316 | `test_task_atm_gov_0316_hostile_parallel_6f3a8b20`, `test_task_atm_gov_0316_phase_exit_saturation_1c7e5a94` |
| 0317 | `test_task_atm_gov_0317_four_plan_certificate_5b9d2e71`, `test_task_atm_gov_0317_legacy_retirement_gate_8a4f1c36` |

Shard files live under `tests/catalog/groups/` in the target repo. The exact
focused test paths are declared in each card's validator list and are expected
to be added by the implementing lane, not pre-created as empty green tests.
Read-only `tasks status` confirms all four are `planned/no-claim` with no
planning divergence, but ATM currently labels their quiet residue as
`ambiguous-manual-review`; do not reinterpret that advisory classification as
completion or auto-clean it. Re-run status after the frozen runner is synced.
The four ledger imports also emitted `ATM_RUNNER_SYNC_REQUIRED`. This is
permitted for ledger-only planning writes, but it is a hard pre-claim gate:
before implementing 0314–0317, execute the governed build/runner-sync path and
record source/frozen digest parity. Validator output from the stale runner is
not admissible evidence.
Latest read-only observation (2026-08-01T04:43:31+08:00): 0313 remains
`running/active` for Claude-007; its implementation, schema, catalog shards,
and regression-test paths are dirty in the canonical worktree, with no release
or closure evidence transition visible. Broker and team queues are currently
empty, but the frozen runner reports `ATM_RUNNER_SYNC_REQUIRED`. Preserve the
lane and keep the alias/backlog disposition pending; do not build or stage the
active lane's WIP from this handoff lane.
Use the phase readiness ledger at
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan4-phase-readiness-2026-07-31.json`;
its `liveLaneSnapshot` records 0313 as Claude-007's active authoritative lane,
zero broker intents, zero team runs, and `implementationEvidence` as
`not-yet-sealed`. It currently marks every 0314–0317 card `claimReady=false`
and lists the specific dependency, runner, test, and evidence blockers.
Its `recommendedTopologicalOrder` is the canonical dispatch order; do not
parallelize across a listed dependency edge or infer readiness from an empty
claim state alone.
The matrix now explicitly carries the related runner-sync cluster
`ATM-BUG-2026-07-22-225`, `ATM-BUG-2026-07-29-265`, and
`ATM-BUG-2026-07-30-283`; these require separate repair-card/fresh-receipt
disposition and must not be counted as fixed merely because planning imports
were allowed.
The machine-readable census now records this cluster as
`confirmed-open-like`, and records the 0313 alias-lineage issue as
`confirmed-pending-formal-backlog-id`; both have `freshEvidence: null` and
remain final-verdict blockers.

The next captain must preserve one canonical worktree per repository and must
not clean foreign work by guesswork. ATM-GOV-0306 is now done and released;
preserve its close evidence and do not reopen or amend it without a new
governed follow-up card.

The current legal dependency chain is:

`ATM-GOV-0285 (done) -> ATM-GOV-0306 (done) -> ATM-GOV-0293 -> ATM-GOV-0294 -> ATM-GOV-0305 -> TASK-SKL-0037`

Latest verified runtime snapshot: `ATM-GOV-0306=done/claim-released` owned by
`cursor-0306`; `ATM-GOV-0293=planned/no-claim`. 0306 has a closure packet,
seal-and-commit evidence, runner-sync receipt, and delivery chain
`b31579017 -> a9680a39 -> 51ab0b3fe`; planning closeback is
`88e3cc54e02745c61ce203ee4bba874841458b27`.
Authoritative update: 0306 is closed; the next gate is 0293, not a 0306
reopen. The stale wording on the following legacy line must be ignored.
The supported audit commands are `evidence validators --list` and
`evidence missing`; 0306 has all 5 closure-required validators fresh, while
4 heavyweight framework validators are advisory-absent and do not block close.
This snapshot supersedes any older “0306 complete” wording.

Plan 3.0/3.1 historical dashboard and sealed dogfood freshness remains an
audit obligation; it is not evidence that the chain above may be skipped.

Snapshot authority (latest): 0306 is `done/released`; any earlier sentence
describing it as active or not yet closed is superseded by the live ledger and
the closure evidence listed above.

The authoritative first-pass audit artifact is:

`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan-3x-4x-objective-evidence-matrix-2026-07-31.md`

The matrix denominator was independently checked against source text: Plan 3.0
completion is clauses 820–836; clause 837 starts `Out Of Scope` and is not a
completion objective. Plan 3.1, 3.2, and 4.0 source ranges are likewise listed
explicitly in the matrix; a missing source clause is an audit defect.
Plan 3.2 clauses 124–135 and 166–183 were expanded from grouped ranges into
individual ledger rows in this amendment; do not collapse them back into a
single summary row when attaching evidence.
The read-only mapping audit reports 17/17 Plan 3.0 rows, 23/23 Plan 3.1 rows,
29/29 Plan 3.2 rows, and 17/17 Plan 4.0 section anchors, with zero missing
source rows. This is mapping completeness only; every row remains unverified
until its full evidence tuple is linked.

Plan 4.0 §18.4.2 now names the same file as its sole certification matrix;
task cards, dashboards, and release notes must link back to it rather than
creating competing completion lists.

Plan 4.0 §18.1's “may start before Plan 3.2 completes” wording is only a
bounded start permission. It does not certify any predecessor plan, objective,
or parallel-readiness verdict; Claude-007 must keep the matrix rows unresolved
until their evidence tuples are complete.

Its status is `audit-in-progress`; all rows currently marked `partial`,
`blocked`, or `not-complete` must be revalidated and upgraded only by direct
evidence. Claude-007 must amend the matrix in place rather than creating a
second competing checklist.

## Current completed boundary

- ATM-GOV-0269, 0274, 0275, 0276, 0279, 0280, 0284, 0285: done/released.
- TASK-GIT-0029, 0030, 0031: done/released.
- ATM-GOV-0306 source card exists in the external planning repo and target
  ledger is imported as `done/released`; its closure packet is present.
- ATM-GOV-0312 (coverage certificate/quality vector) and ATM-GOV-0307 (state
  replay/known incident corpus) now have complete source cards and planned
  target ledgers. Both cards now carry resolvable `testContributions` and
  `requiredTestCaseIds`; their import evidence is command-backed. 0307 depends
  on 0306, 0293, and 0312; neither card is claimed or implemented.
  Import receipts: `.atm/history/reports/task-import/2026-07-31T14-24-10-157Z.json`
  (0307) and `.atm/history/reports/task-import/2026-07-31T14-24-18-893Z.json`      
  (0312). These prove card-contract import only, not implementation or plan        
  completion.
- ATM-GOV-0313 (catalog namespace migration) is now created through the
  registered GOV planning series and has an active live claim by Claude-007;
  its planning mirror remains `planned`. Its import
  evidence is `.atm/history/reports/task-import/2026-07-31T14-31-57-459Z.json`;
  the two required cases resolve through `test_group_plan4_catalog_contract`.
  A post-edit dry-run at 14:37:21Z is also clean. This is a repair card, not
  repair proof.
  The target catalog shards are contract scaffolds owned by those cards;
  focused test files and production modules still do not exist. 0313's catalog
  contract scaffold is also present, but its historical-ID migration and full
  validator repair are not implemented.
- Plan 4.0 table entries `ATM-GOV-0308`–`ATM-GOV-0311` remain reserved only:
  all four source cards and target ledgers are missing. They are not claimable,
  and their phase-table presence is not evidence of implementation.
- ATM-GOV-0293 source and target ledger now depend on 0306, with amendment
  epoch 3 and frontmatter fidelity passing.
- The stale mixed batch `batch-3b57f658b7ca` is abandoned; do not revive it.

Verified baseline now includes a real 0285 two-lane observation: Claude's
`ee1b7cc3f` delivery excluded concurrent Cursor 0293/0306 ledger changes,
runner-sync and validators passed, and no override lease was used. This proves
only the foreign-work exclusion slice; it is not a full Plan 3.2 or Plan 4.0
completion proof.

## Delivered lane to preserve

The former Cursor / ATM-GOV-0306 lane delivered mutation-lineage source,
schema, tests, catalog shard, evidence, task events, and the shared evidence
index export. Preserve these delivered paths and their receipts; do not amend
them in place:

- `packages/core/src/evidence/mutation-lineage.ts`
- `packages/core/src/evidence/index.ts`
- `schemas/evidence/mutation-lineage.schema.json`
- `tests/catalog/groups/test_group_plan4_mutation_lineage.shard.json`
- `tests/cli/plan4-mutation-adapter.test.ts`
- `tests/cli/plan4-mutation-lineage-equivalence.test.ts`
- `.atm/history/tasks/ATM-GOV-0306.json`
- `.atm/history/evidence/ATM-GOV-0306*`
- `.atm/history/task-events/ATM-GOV-0306/`

The 0306 close report says staged residue is empty and its residue diagnosis is
`no-residue`; do not recreate the former temporary pre-close/publication files.

## Ordered work programme

## Plan-completion certification rule (non-negotiable)

Task-card `done` is not a plan-completion verdict. Claude-007 must create a
plan-level audit matrix for **every objective** in Plan 3.0, 3.1, 3.2, and 4.0:

| Plan | Required proof before completion | Completion rule |
| --- | --- | --- |
| 3.0 | every objective, replay/dashboard/telemetry target, fresh sealed dogfood and performance receipt | no objective may remain `historical-only`, `unknown`, or stale |
| 3.1 | every broker/steward/claim/commit/runner objective, real two-lane evidence, dashboard and final verdict reconciliation | later repairs must be replayed against the final implementation |
| 3.2 | every adapter/import/close/identity/parallel-commit objective, including the 0269/0274/0275/0276 lessons | real concurrent run and exact attribution proof are mandatory |
| 4.0 | every coverage universe, obligation, gauntlet, mutation, fingerprint, causal, selective-routing, skill-projection and phase-exit objective | all required cases, incident families, receipts and release gates must be green |

The audit matrix must bind each plan objective to: source implementation,
task/card, acceptance predicate, focused test id, validator receipt, fresh
sealed evidence, real-dogfood observation, known-bug references, and final
disposition. A task card without these bindings is incomplete.

The matrix also contains a source-clause coverage index. It maps Plan 3.0
completion clauses 820-837, Plan 3.1 completion clauses 526-548, Plan 3.2
success criteria 124-135 plus parallel-safety clauses 158-183, and the Plan
4.0 objective families in sections 4 through 18.4.2. A source clause cannot
disappear merely because its task card closed; unverified clauses remain
`not-complete` in the same matrix.

The matrix now includes a clause-level audit ledger for every Plan 3.0/3.1
completion clause and every Plan 3.2 success/safety clause. Claude-007 must
update the individual clause row with the same evidence tuple as the objective
row; do not upgrade a whole range because one neighboring card passed.

It also includes a Plan 4.0 section-level ledger (`§§4.1–18.4.2`) covering the
deep modules, contracts, generators, uncertainty, authority, adapters,
profiles, phases, incident gate, and final certification. A Plan 4.0 card may
close only its own section obligations; the section row stays unresolved until
the objective certificate and fresh phase-exit evidence consume it.

Apply the first-principles/deep-module gate before upgrading architecture rows:
each policy or orchestration module needs a sealed `atm.deepModuleReviewReport.v1`
with one public interface, two concrete adapters, deletion-test result,
dependency classes, rollback, and causal validators. 0284 and 0306 currently
have interface tests and card rollback declarations but no sealed downstream
deep-module receipt; keep those rows `partial` and do not reopen either closed
card merely to manufacture one.

All known ATM bugs and dogfood incidents must be imported into the final Plan
4.0 incident corpus, mapped to a generic family, and closed with a regression
test plus repair evidence. An incident may remain `open`, `candidate`, or
`unavailable` only with an explicit owner-approved exception; such an exception
blocks the Plan 4.0 final verdict and the overall parallel-development claim.

New audit finding `ATM-BUG-2026-07-31-012` is Open: the full catalog-shard
validator currently fails because historical `test_atm_gov_` IDs do not satisfy
the canonical `test_int_`/`test_task_` schema. 0307/0312 use schema-valid
`test_task_atm_gov_` IDs, but they do not repair the historical shard. Route 012
through ATM-GOV-0313 before claiming catalog-wide green. Its required sequence
is canonical-ID migration with aliases, governed re-import of still-planned
cards, full-catalog validation, and fresh sealed evidence.

The latest backlog census is sealed at
`C:/Users/User/3KLife/docs/ai_atomic_framework/governance-optimization/plan4-backlog-disposition-census-2026-07-31.json`
(`sortedOpenLikeIdDigest=sha256:48271f04905274a5c795c894395d578c1e29b196aeba1193279e50d26ca18ff6`).
It records 378 shards, with 169
open-like items (81 `Open`, 78 `Needs task card`, 2 `Needs triage`, 1 `In progress`,
plus seven partial/active/deferred/follow-up statuses; 73 High and 1 Critical
severity). The seven parallel incident families plus 012 cover confirmed
escaped incidents only, not this entire set. Before final verdict, Claude-007
must give every open-like item a durable disposition—owning family/repair card,
explicit non-confirmed candidate/duplicate/product-gap rationale, or an
owner-approved exception that still blocks completion. Do not report a clean
incident register while this census remains unresolved.

Additional mirror blocker: `tasks status --task TASK-SKL-0036 --json` reports
live ledger `done/released` but planning frontmatter `planned`, divergence
`status`, and residue bucket `stale-import`. Do not consume TASK-SKL-0036 as
completed skill/backlog authority until the returned governed
`tasks import --write --reconcile-mirror` route succeeds and fresh evidence is
attached.

Claude-007 must not report “Plan 3.x/4.0 complete”, “parallel development
ready”, or “release ready” until the four matrices are complete, all required
bugs are repaired, and the final phase-exit manifest proves no unresolved
objective, stale evidence, missing fixture, or unclassified known bug.

The matrix now contains objective-level contracts for the still-reserved cards:
0308 must prove sealed legacy-vs-selected/broad shadow recall and invalidate the
selector epoch on escaped related defects; 0309 must prove six projection
machine-field/source/compiler/manifest digest parity plus reinstall and frozen
smoke; 0310 must prove fresh real two-captain hostile dogfood, recurrence,
saturation, rollback, and an all-branch phase-exit manifest; 0311 must consume
0310 and report objective/card/incident/fresh-evidence/release dimensions
separately, blocking legacy retirement on any open bug, unknown, stale branch,
or unverified row. These are card-authoring contracts, not completed evidence.

1. **Read-only dual-repo preflight.** Record owner, foreign, staged, and
   untracked files separately in both repos. Never absorb Cursor, SKL, POA, or
   historical residue into a delivery commit.
2. **Consume 0306 close evidence.** Verify focused tests, typecheck, CLI
   validation, evidence, bundle/tree attribution, no override lease, and
   released claim; do not reopen the closed card.
3. **Verify 0306 plan-level sufficiency.** Confirm its focused tests,
   validators, closure packet, runner receipt, provenance, and rollback, then
   keep the matrix row `partial` until a fresh Plan 4 dogfood consumes it.
4. **Run ATM-GOV-0313.** Repair the catalog namespace blocker first; preserve
   historical evidence, update planned-card IDs through governed imports, and
   require the full catalog validator to pass.
5. **Reconcile TASK-SKL-0036 planning mirror first.** Use the exact governed
   command returned by `tasks status`; verify source/ledger/projection fidelity
   before treating the incident-learning intake as a completion authority.
6. **Run the backlog disposition census through TASK-SKL-0036/0037.** Every
   open-like item must be assigned to a family/repair card, explicitly marked
   non-confirmed with rationale, or held under an owner-approved exception;
   do not let the seven incident families stand in for the 169-item census.
7. **Run ATM-GOV-0293.** It consumes 0306 lineage/equivalence evidence and the
  Plan 3.2 dual-captain incident fixtures. Preserve its fail-closed family
  matching and provenance requirements.
8. **Run ATM-GOV-0294**, then **ATM-GOV-0305**. These are dependency-ordered;
   do not claim ahead of the chain or revive the abandoned batch.
9. **Run ATM-GOV-0312** after its listed prerequisites and before incident
   corpus certification. It must produce the objective-level certificate and
   explicit non-claims without using a compensating score.
10. **Run ATM-GOV-0307** after 0293 and 0312. It owns the generic replay
    fixtures and regression evidence for all seven required families: 009,
    010, 011, 270, 0276, runner-sync protected-state, and stale/mixed-batch
    ownership/routing. Do not treat a fixture-only green result as plan
    completion; each family also needs the real dogfood receipt and rollback
    proof required by the matrix.
11. **Run TASK-SKL-0037** after 0305. Verify Plan 4 exam-authority, selective
   regression, incident-learning, and adapter projection parity.
12. **Author and import 0308–0311 only when their prerequisites are sealed.**
   Use `atm plan card create`, complete acceptance/test/validator/rollback
   fields, dry-run each import, then import one card at a time. Do not claim a
   reserved id from the Plan 4 table or create a substitute ledger by hand.
13. **Fresh Plan 3.0/3.1 audit.** Re-check 0234/0235 performance evidence,
   0245 final verdict, 0246 dashboard/run manifest, and frozen-runner freshness.
14. **Plan 3.2 residue audit.** In 3KLife, inspect 0269 residue and planning
   mirror state. Reconcile only through ATM commands and only when ownership is
   proven.
15. **Only after all gates pass:** conduct a new dual-captain dogfood run and
   publish a phase-exit verdict with fresh sealed evidence.

## Mandatory parallel-governance invariants

- A governed commit tree must be a subset of the admitted bundle and declared
  shared-delivery members.
- Final apply must consume the sealed bundle, never re-read the live index.
- HEAD movement is broker/CAS guarded; moved HEAD returns queue/wait/retry.
- Success paths must not use override leases.
- Multi-lane unowned dirty paths fail closed; shared files use steward/compose
  attribution.
- Close deferral must not leave a derived manifest behind.
- Batch ownership must support safe split, handoff, stale-head repair, and
  abandon.
- Every incident becomes a generic fixture and focused regression case.
- The required corpus is exactly the seven families assigned to ATM-GOV-0307;
  Plan 4.0 §18.4.1 is the normative cross-plan gate and the matrix is the only
  completion checklist. If the two documents disagree, stop and reconcile the
  source plan before dispatching implementation.

## Known foreign residue — do not touch by default

Framework repo:

- `artifacts/generated/skill-corpus-audit.json`
- `.atm/history/protected-override-audit/`
- `TASK-SKL-0037` ledger/events
- `atomic_workbench/atoms/ATM-GOV-0001/atom.test.report.json`
- this handoff file itself is an untracked captain artifact; include it only in
  an explicitly scoped documentation commit, never with foreign residue
- Cursor's 0293 ledger/evidence and any future follow-up events

3KLife repo:

- `.atm/catalog/registry/actors.json`
- `.atm/runtime/identity/default.json`
- `.atm/history/task-events/ATM-GOV-0269/`
- 0269 planning card residue until ownership and reconciliation are proven
- any Cursor 0306/0293 planning edits until their close packet is complete

## Commit and push policy

- First attempt normal `node atm.mjs git commit`, runner-sync, and push.
- Keep an exact path allowlist and verify `git show --name-only` after commit.
- Never use force-push, branch/rebase/worktree, raw reset, or broad restore.
- Emergency pathspec commit requires a named ATM error, failed normal route,
  exact keep-list, and explicit owner authority.
- Push each repo only when index is clean for the selected lane and all foreign
  residue is explicitly excluded.
- The external matrix and Plan 4.0 amendments are planning-authority changes;
  they are not 0307/0312 implementation deliverables. Commit/push them through
  a dedicated governed documentation scope or leave them for the incoming
  captain to stage after preflight.

## Handoff stop rule

Stop and report if ownership is ambiguous, a shared index contains foreign
staged work, a dependency ledger disagrees with its planning card, a runner or
historical attestation is missing, or a normal broker route returns a refusal
without a queue/recovery ticket.

## Current overall verdict

`NOT COMPLETE / AUDIT IN PROGRESS`.

This verdict is intentional. The matrix has not yet proven every Plan 3.0,
3.1, 3.2, and 4.0 objective, and the known-bug closure register is not empty.
Do not downgrade this to “ready” because individual cards close successfully.

## First commands for Claude-007

## Matrix execution protocol

For each matrix row, Claude-007 must append or update the same row with this
compact evidence tuple before changing its disposition:

`objective | source/task | acceptance | requiredTestCaseIds | validator receipt | fresh sealed evidence | real dogfood receipt | bug/incident refs | rollback | verdict`

Use this order for every row:

1. Read the source plan section and its task-card causal graph.
2. Inspect the live ledger, closure packet, delivery/release commits, and
   planning mirror; record divergence rather than guessing.
3. Locate the required test IDs and run only the causal focused validators
   first; record command, exit code, runner kind, duration, and evidence path.
4. Check whether the evidence was produced after the final repair commit and
   whether it represents a real worktree/dogfood observation rather than a
   fixture-only replay.
5. Search the bug backlog and incident corpus for the objective's known failure
   classes. A missing mapping is a gap, not a clean result.
6. Apply the deep-module deletion test and interface/adapter receipt wherever
   the row changes policy, orchestration, or repeated failure handling.
7. Update the matrix row only after the evidence tuple is complete. Preserve
`not-complete` when any element is unavailable.

The matrix bug table is the operational queue. Claude-007 must not reorder it
by convenience: first consume the now-closed 0306 evidence, then close
009/011 task-card gaps and the 270 backlog status, then run the repaired
incident families through Plan 4.0 before attempting a final push.

Required audit command families:

```powershell
node atm.mjs tasks status --task <id> --json
node atm.mjs evidence validators --list --task <id> --json
node atm.mjs evidence missing --task <id> --actor <actor-id> --json
node atm.mjs broker status --json
node atm.mjs team status --compact --json
node atm.mjs doctor --json
```

The command output is evidence only after checking that it covers the row's
actual objective and current repair commit. Claude-007 must not bulk-convert
rows from `planned` to `verified` using ledger status alone.

```powershell
node atm.mjs next --prompt "Audit both repository worktrees and continue the governed Plan 4 chain after ATM-GOV-0306; preserve Cursor WIP and do not open duplicate cards." --json
node atm.mjs broker status --json
node atm.mjs team status --compact --json
```

Do not claim a new task until the first command's playbook and active-claim
ownership have been read.
