# ATM Self-Atomization Dogfood Score

- Generated: 2026-05-25T13:18:36.562Z
- Overall score: **52 / 100** (Grade F)
- Stage: `dogfood-core`
- Trend: stable
- Schema: `atm.dogfoodScore.v1`

## Component scores

| Component | Score | Pass threshold | Fail threshold | Status |
|---|---|---|---|---|
| source_ownership_coverage | 55 | 95 | 80 | ❌ fail |
| public_command_coverage | 0 | 95 | 80 | ❌ fail |
| atom_with_test_evidence | 100 | 80 | 60 | ✅ pass |
| atom_with_rollback_evidence | 0 | 70 | 50 | ❌ fail |
| excluded_paths_with_reason | 100 | 95 | 90 | ✅ pass |
| runAtm_with_readable_ref | 0 | 100 | 95 | ❌ fail |

## Inventory snapshot

- production source paths: 428
- owned by registry: 237
- unowned: 191
- coverage: 55%

## Priority gaps

- public_command_coverage: 0% → 95% (driven by TASK-ASA-0007,TASK-ASA-0009)
- atom_with_rollback_evidence: 0% → 70% (driven by TASK-ASA-0010)
- runAtm_with_readable_ref: 0% → 100% (driven by TASK-ASA-0013)
- source_ownership_coverage: 55% → 95% (driven by TASK-ASA-0006,TASK-ASA-0008,TASK-ASA-0009)

## Next high-ROI area

- public_command_coverage

## Notes

- Score schema: `atm.dogfoodScore.v1` (see docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.4)
- Grade thresholds: A ≥ 90, B ≥ 80, C ≥ 70, F < 70
