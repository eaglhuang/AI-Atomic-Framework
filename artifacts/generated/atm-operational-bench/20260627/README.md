# ATM OperationalBench v0.1

This artifact is part of the ATM Bench family. It is the operational-overhead sibling of AdmissionBench and uses the same `docs/bench`, `bench:*`, validator registry, and generated-artifact conventions.

OperationalBench measures ATM-local operational overhead only. It must not be cited as showing that ATM is faster or slower than CoAgent, S-Bus, CodeTeam, or any external system.

Validator cost is listed independently as `validatorMs`. Unexecuted spans are `null`, never `0`.

Fail-closed means fail-closed to unsafe direct or parallel apply. It does not mean the original intent was discarded.

Blocked cases are reported separately as queue, serialization, steward review, rebase replay, refinement, and terminal fail-closed.

Profile: `paper`; warmup: `10`; repeat: `100`; concurrency: `1, 5, 10, 20`; seed: `20260627`.

Reproduce:

```bash
npm run bench:operational:paper -- --seed 20260627
npm run validate:operational-bench
```

Required files:

- `summary.json`
- `results.jsonl`
- `paper-table.md`
- `scenario-manifest.json`
- `artifact-hash-manifest.sha256`

Full regeneration rate is `null`: not observed by this harness.
