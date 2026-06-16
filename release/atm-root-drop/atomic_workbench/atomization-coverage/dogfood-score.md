# ATM Self-Atomization Dogfood Score

- Overall score: **95 / 100** (Grade A)
- Stage: `dogfood-excellent`
- Trend: stable
- Schema: `atm.dogfoodScore.v1`

## Component scores

| Component | Score | Pass threshold | Fail threshold | Status |
|---|---|---|---|---|
| source_ownership_coverage | 84 | 95 | 80 | ⚠️ at-risk |
| public_command_coverage | 100 | 95 | 80 | ✅ pass |
| atom_with_test_evidence | 100 | 80 | 60 | ✅ pass |
| atom_with_rollback_evidence | 100 | 70 | 50 | ✅ pass |
| excluded_paths_with_reason | 100 | 95 | 90 | ✅ pass |
| runAtm_with_readable_ref | 100 | 100 | 95 | ✅ pass |

## Inventory snapshot

- production source paths: 609
- owned by registry: 514
- unowned: 95
- coverage: 84%

## Priority gaps

- source_ownership_coverage: 84% → 95% (driven by TASK-ASA-0006,TASK-ASA-0008,TASK-ASA-0009)

## Next high-ROI area

- source_ownership_coverage

## Notes

- Score schema: `atm.dogfoodScore.v1` (see docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.4)
- Grade thresholds: A ≥ 90, B ≥ 80, C ≥ 70, F < 70
