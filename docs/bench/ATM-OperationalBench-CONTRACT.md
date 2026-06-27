# ATM OperationalBench v0.1 Contract

OperationalBench is an ATM Bench family member. It is the operational-overhead sibling of AdmissionBench and uses the same repo conventions: `docs/bench`, `bench:*` npm scripts, validator registry wiring, generated artifacts, JSONL rows, Markdown paper tables, and hash manifests.

OperationalBench measures ATM-local operational overhead only. It is not an external comparison benchmark and must not be cited as showing that ATM is faster or slower than CoAgent, S-Bus, CodeTeam, or any other system.

## Profiles

| Profile | Warmup | Repeat | Concurrency |
| --- | ---: | ---: | --- |
| `smoke` | 2 | 10 | `1, 5` |
| `paper` | 10 | 100 | `1, 5, 10, 20` |
| `extended` | 20 | 300 | `1, 5, 10, 20, 50` |

The official 20260627 evidence artifact uses:

```bash
npm run bench:operational:paper -- --seed 20260627
```

Default official output:

```text
artifacts/generated/atm-operational-bench/20260627/
```

## Tracks

Track A, broker admission overhead:

- `different-file`
- `same-file-bounded-disjoint`
- `shared-surface-conflict`
- `read-write-dependency`

Track B, Git boundary / pre-push overhead:

- `allow-remote-local-disjoint`
- `block-same-record-conflict`
- `composer-disjoint-records`
- `recover-block-non-fast-forward`
- `recover-composer-non-fast-forward`

Track C, recovery-routing stress:

- `serial-queue`
- `steward-review`
- `rebase-replay`
- `refinement-needed`
- `terminal-insufficient-evidence`

## Metrics

Every result row records these spans:

- `diffConstructionMs`
- `mutationRequestConstructionMs`
- `admissionDecisionMs`
- `composerPlanMs`
- `stewardDryRunMs`
- `stewardApplyMs`
- `validatorMs`
- `gitAdmitDryRunMs`
- `casMismatchRecoveryMs`
- `queueWaitMs`
- `totalScenarioMs`

Unexecuted spans must be `null`, not `0`. Observed spans may be very small but remain measured values. `summary.json` reports count, min, max, mean, stddev, p50, p95, and p99 for every span.

Validator cost is listed independently as `validatorMs`; do not fold it into admission, composer, steward, Git dry-run, recovery, or queue spans when citing component overhead.

## Recovery Metrics

Recovery metrics are separate:

- `preservedIntentSalvageRate`
- `terminalFailClosedRate`
- `overSerializationRate`
- `fullRegenerationRate`

If no real full-regeneration observation is produced by this harness, `fullRegenerationRate` must be `null` and accompanied by `not observed by this harness`.

Fail-closed means fail-closed to unsafe direct or parallel apply. It does not mean the original intent was discarded.

Blocked cases must be separated into:

- queue
- serialization
- steward review
- rebase replay
- refinement
- terminal fail-closed

## Required Artifacts

The official evidence directory must include at least:

- `summary.json`
- `results.jsonl`
- `paper-table.md`
- `scenario-manifest.json`
- `artifact-hash-manifest.sha256`
- `README.md`

Evidence runs may also include validator transcripts and closure notes. If those files are added after the benchmark run, regenerate `artifact-hash-manifest.sha256`.

## Validation

Minimum acceptance commands:

```bash
npm run validate:operational-bench
npm run bench:operational:paper -- --seed 20260627
npm run validate:team-brokered-write
npm run validate:broker-steward
npm run validate:schemas
npm run typecheck
git diff --check
```

If a script is unavailable in a future repo revision, use the closest existing ATM validator and record the substitution in the evidence transcript.
