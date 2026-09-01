# Plan 4.0 §18.4.2 Backlog Family Mapping — ANALYSIS PROPOSAL (Claude-007, 2026-08-08)

**This is an analysis proposal only.** No backlog item `status` field, ledger, or card was modified while producing it. Every family/owner-card mapping below is a **proposal requiring owner/captain confirmation** before any card claims, imports, or references these item ids. "NEW CARD NEEDED" means no existing card plainly owns that surface — do not invent an id.

Source of truth read: `docs/governance/atm-bug-and-optimization-backlog.items/*.json` (378 shards), cross-checked against `3KLife/docs/ai_atomic_framework/governance-optimization/plan4-backlog-disposition-census-2026-07-31.json` (already-mapped 4 families) and `.atm/history/tasks/*.json` for candidate owner cards.

## Summary counts

| Metric | Count |
|---|---|
| Total open-like items (census) | 169 |
| Already mapped in prior census (4 families) | 14 (of the census's 15 ids; 1 id, ATM-BUG-2026-07-31-012, is no longer present as an open-like shard) |
| Remaining items analyzed here | 155 |
| Newly clustered into families | 155 (100%) |
| Families used (incl. 4 reused census names) | 14 |
| Flagged as likely duplicates | 6 |
| Flagged as product-gap/enhancement (type=`Product gap`) | 19 (cross-listed inside their families, not a separate bucket) |
| Unclassifiable / needs owner decision | 0 items unplaceable, but see low-confidence note at bottom |
| Critical severity (this batch) | 1 |
| High severity (this batch) | 62 |

## Already-mapped (prior census — excluded from re-analysis)

| Family | Owner | ids |
|---|---|---|
| parallel-commit-and-close-incidents | ATM-GOV-0307 | 07-31-009, 07-31-010, 07-31-011, 07-29-270 |
| catalog-alias-lineage-schema | ATM-GOV-0313 | 07-31-012 (no longer present as a shard) |
| recent-governance-operator-regressions | ATM-GOV-0324 | 07-31-002..008 (7) |
| runner-sync-freshness-and-publication | ATM-GOV-0314, 0316, 0317 | 07-22-225, 07-29-265, 07-30-283 |

(ids abbreviated; full id is `ATM-BUG-2026-<id>`.)

## Family tables (155 items, this analysis)

### A. runner-sync-freshness-and-publication (reused census family — extend the existing owner cards)
Proposed owner: **ATM-GOV-0314 / 0316 / 0317** (existing, plainly owns this surface). Count: 30

07-14-183, 07-16-013, 07-18-004, 07-18-005, 07-19-001, 07-19-013, 07-19-016, 07-19-019, 07-19-020, 07-19-022, 07-19-023(dup of 07-19-020), 07-19-025, 07-19-035, 07-20-210, 07-20-211(recurrence of 07-19-001), 07-20-212, 07-20-214, 07-20-215, 07-21-218, 07-21-220(recurrence of 07-19-001), 07-22-226, 07-22-228, 07-22-234, 07-29-254, 07-29-257, 07-29-261, 07-29-262, 07-29-264, 07-29-273, 07-30-280, 07-30-284(recurrence of 07-19-001)

### B. claim-lease-lane-ownership-and-actor-identity
Proposed owner: **NEW CARD NEEDED** (id to be assigned). Count: 23

07-11-113, 07-12-115, 07-12-140, 07-13-162, 07-15-205, 07-18-001, 07-18-002, 07-18-003, 07-19-030, 07-19-031, 07-19-040, 07-21-217, 07-22-229, 07-22-232, 07-22-235, 07-22-236, 07-27-242, 07-29-247, 07-29-248, 07-29-249, 07-29-267, 07-29-271(dup of 07-29-249), 07-30-277(dup of 07-29-249)

### C. scope-amendment-and-claim-admission-line-budget
Proposed owner: **NEW CARD NEEDED**. Count: 6

07-12-142, 07-19-005, 07-19-038, 07-22-230, 07-22-231, 07-27-241

### D. taskflow-close-residue-and-dirty-artifact-classification
Proposed owner: **NEW CARD NEEDED** (adjacent to but distinct from family A — this is about taskflow's own close-bundle scoping, not runner-sync specifically). Count: 7

07-11-098, 07-12-126, 07-12-160, 07-16-005, 07-16-012, 07-21-221, 07-24-240

### E. batch-checkpoint-and-queue-atomicity
Proposed owner: **NEW CARD NEEDED**. Count: 7

07-19-002, 07-19-009, 07-19-029, 07-21-219, 07-29-253, 07-29-256, 07-29-259

### F. task-import-and-planning-mirror-reconciliation
Proposed owner: **NEW CARD NEEDED**. Count: 7

07-19-039, 07-27-245, 07-29-251, 07-29-258, 07-29-266, 07-30-278, 07-30-282

### G. governed-git-commit-and-pre-commit-hook-admission
Proposed owner: **ATM-GOV-0265** for 07-27-243 only (explicit live-reproduction of the 0265 branch-commit-queue deadlock). Everything else: **NEW CARD NEEDED**. Count: 10

07-11-115, 07-13-163, 07-15-195, 07-15-200, 07-15-203, 07-22-233, 07-27-243→0265, 07-29-255, 07-29-263, 07-29-272, 07-29-274

### H. broker-conflict-and-reservation-supersession
Proposed owner: **NEW CARD NEEDED** (adjacent to ATM-GOV-0307 but a distinct surface — reservation/lease supersession, not commit attribution). Count: 9

07-12-127, 07-12-134 (Critical-adjacent, High), 07-15-202, 07-16-007, 07-19-036, 07-20-213, 07-22-224, 07-29-250, 07-29-268(dup of 07-29-250)

### I. windows-cli-text-io-and-quoting-ux
Proposed owner: **NEW CARD NEEDED**. Count: 6

07-19-006, 07-19-017, 07-19-021, 07-19-032, 07-19-033, 07-19-041

### J. first-layer-guidance-and-routing-ux
Proposed owner: **NEW CARD NEEDED**. Count: 15

07-16-017, 07-16-019, 07-17-001, 07-19-003, 07-19-008, 07-19-026, 07-19-028, 07-19-037, 07-19-042, 07-19-043, 07-20-206, 07-22-227, 07-22-237, 07-24-239, 07-27-246

### K. team-agents-direct-provider-execution-fidelity
Proposed owner: **NEW CARD NEEDED** (adjacent lineage: TASK-TEAM-0053/0066/0068/0074/0079/0084, all closed — no open governance card covers the residual gaps). Count: 7

07-11-096, 07-11-100, 07-11-101, 07-11-103, 07-11-104, 07-11-107, 07-12-114

### L. evidence-catalog-and-validator-telemetry-contract
Proposed owner: **ATM-GOV-0313** for 07-31-013 only (Critical — catalog validator blindness, same schema surface as the reused census family). Everything else: **NEW CARD NEEDED**. Count: 18

07-12-145, 07-14-189, 07-15-198, 07-15-199, 07-16-020, 07-19-004, 07-19-010, 07-19-018, 07-19-024, 07-19-027, 07-19-034, 07-19-044, 07-24-238, 07-29-260, 07-30-275, 07-30-276, 07-30-279, 07-31-013→0313

### M. cross-repo-planning-authority-and-performance
Proposed owner: **NEW CARD NEEDED**. Count: 3

07-11-120, 07-12-119, 07-14-187

### N. post-facade-extraction-module-quality-debt
Proposed owner: **NEW CARD NEEDED** (each item names a specific closed TASK-RFT-00xx as the origin of the residual facade-quality debt, but none of those closed cards owns the follow-up). Count: 6

07-15-193, 07-15-194, 07-15-195(cross-listed in G — pre-commit path also implicated; primary home is N), 07-15-196, 07-15-197, 07-15-200(cross-listed in G)

## Duplicates identified

| Item | Duplicate of | Rationale |
|---|---|---|
| ATM-BUG-2026-07-19-023 | ATM-BUG-2026-07-19-020 | Both: required runner-sync/release outputs excluded from taskflow close bundle — same defect, different report date |
| ATM-BUG-2026-07-20-211 | ATM-BUG-2026-07-19-001 | Same recurring pattern: post-close runner-sync receipt/release artifacts left dirty and misclassified |
| ATM-BUG-2026-07-21-220 | ATM-BUG-2026-07-19-001 | Same recurring pattern, different governed task instance |
| ATM-BUG-2026-07-30-284 | ATM-BUG-2026-07-19-001 | Same recurring pattern, different governed task instance |
| ATM-BUG-2026-07-30-277 | ATM-BUG-2026-07-29-249 | Both: lane-session id rendered as actor-vs-actor `ATM_TASK_CLAIM_OWNER_MISMATCH` |
| ATM-BUG-2026-07-29-268 | ATM-BUG-2026-07-29-250 | Both: broker reservation/conflict-resolution leaves opposing artifacts for the same path with no supersession rule |

Note: ATM-BUG-2026-07-29-271 is a close variant of the same 07-29-249 lane-session defect but has slightly different UX framing (silent-mint-new-lane) — kept as a family member rather than a strict duplicate; owner should confirm.

## Product-gap / enhancement candidates (type=`Product gap`, cross-listed above — not defects in the strict sense)

07-12-114, 07-15-205, 07-16-007, 07-18-002, 07-18-005, 07-19-002, 07-19-020, 07-19-021, 07-19-027, 07-19-031, 07-19-036, 07-22-228, 07-22-229, 07-22-230, 07-22-232, 07-24-240, 07-29-254, 07-29-261, 07-30-278

## Critical / High severity — sequencing list (this batch of 155; excludes the 14 already-mapped ids)

**Critical (1):** ATM-BUG-2026-07-31-013 (catalog validator blind to 42% of catalog — family L, owner ATM-GOV-0313)

**High (62):** ATM-BUG-2026-07-11-096, 07-11-098, 07-11-101, 07-11-103, 07-11-104, 07-11-113, 07-12-114, 07-12-119, 07-12-126, 07-12-127, 07-12-134, 07-13-162, 07-13-163, 07-14-183, 07-15-202, 07-15-205, 07-16-007, 07-18-002, 07-18-003, 07-19-001, 07-19-002, 07-19-004, 07-19-009, 07-19-018, 07-19-020, 07-19-022, 07-19-027, 07-19-029, 07-19-032, 07-19-044, 07-20-206, 07-20-210, 07-20-213, 07-21-219, 07-21-220, 07-22-224, 07-22-226, 07-22-228, 07-22-229, 07-22-230, 07-22-232, 07-22-233, 07-22-234, 07-24-239, 07-24-240, 07-27-241, 07-27-243, 07-29-247, 07-29-249, 07-29-250, 07-29-253, 07-29-256, 07-29-257, 07-29-261, 07-29-262, 07-29-264, 07-29-266, 07-29-267, 07-29-273, 07-30-275, 07-30-276, 07-30-280

(All `ATM-BUG-2026-<id>` — prefix omitted for brevity.)

## Unclassifiable / needs owner decision

None of the 155 items were left without a plausible family home. Two lower-confidence placements the owner should sanity-check:

- **ATM-BUG-2026-07-15-195** and **07-15-200** are cross-listed in both family G (pre-commit hook admission) and family N (post-facade-extraction quality debt) because their findings implicate both a facade/readability gap and a hook-path interaction. Pick one primary owner during card authoring.
- Family J (first-layer-guidance-and-routing-ux, 15 items) is the most heterogeneous cluster — it spans CLI discoverability, prompt routing misclassification, and skill-integration gaps that could plausibly split into 2 sub-cards once an owner reviews it. Left as one family here to stay within the requested 10–18 family budget.
