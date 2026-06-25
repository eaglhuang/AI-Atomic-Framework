# ATM-AdmissionBench v0.1 — Frozen Contract

Status: **frozen** (v0.1, 2026-06-25).
Scope: deterministic, auditable smoke benchmark substrate for the ATM admission
gates (compose / registry / conflict-arbitration). This contract pins inputs,
outputs, schemas, and forbidden behaviours so the Generator and Audit agents
share an unambiguous interface.

> The bench does **not** prove ATM correct. It only checks that the
> documented admission rules, validators, and oracle expectations agree on a
> fixed scenario corpus, and emits machine-readable artifacts.

## 1. Authority and forbidden actions

- The contract is authoritative. The runner, fixtures, oracle, and validators
  MUST match every clause below.
- Generator MUST NOT:
  - Modify `docs/reviews/**` or `artifacts/audit/**`.
  - Modify paper claims, result tables, or downstream evidence files.
  - Encode expected per-scenario routes inside validators.
  - Read ATM output to mutate the oracle.
  - Silently weaken existing validators to make cases pass.
- Auditor MUST NOT modify generator outputs; it only consumes them.

## 2. Scenario corpus

The smoke corpus reuses the frozen AGR scenario packs:

- `scripts/fixtures/agr-benchmark/manifest.json`
- `scripts/fixtures/agr-conflict-benchmark/manifest.json`

Plus the bench fixture pack `scripts/fixtures/atm-admission-bench/manifest.json`
which records the smoke selection and seed assignment. The smoke selection is
**all scenarios from both packs**; no scenario is silently excluded.

Each scenario carries its own `groundTruth` (`safeToParallelize`,
`validatorShouldCatch`) which the runner uses as the oracle. The oracle is
read-only.

## 3. Runner contract

Entry point: `scripts/run-atm-admission-bench.ts`.

CLI surface:

```
node --strip-types scripts/run-atm-admission-bench.ts \
    [--seed <uint>] \
    [--mode smoke|export-blind] \
    [--out <directory>]
```

Defaults:

- `--seed 20260625`
- `--mode smoke`
- `--out artifacts/generated/atm-admission-bench/<seed>` for `smoke`
- `--out artifacts/blind-bench/<seed>` for `export-blind`

`smoke` mode:
1. Loads the two AGR scenario packs deterministically.
2. Evaluates each scenario through the existing in-repo logic
   (`runAgrBenchmarkScenario`, `evaluateConflictScenario`). No bench-private
   logic decides verdicts.
3. Emits the artifact set in §4.
4. Exits non-zero if any scenario fails its own expectation, if a false-safe
   regression is detected, or if oracle metadata is missing.

`export-blind` mode:
1. Re-runs `smoke` deterministically.
2. Strips per-scenario expectation fields and writes a blind copy beside a
   `README.md` describing how the auditor reproduces verdicts. Ground-truth
   labels are kept (`safeToParallelize`, `validatorShouldCatch`); per-mode
   `expected.*` routes are removed.

Determinism rules:
- The seed is recorded in every manifest but the runner is fully
  deterministic; the seed gates non-deterministic future extensions only.
- Scenario ordering is the manifest order; mode ordering inside the AGR pack
  is the scenario-declared `relevantModes` order.
- Timestamps in artifacts are derived from `git show -s --format=%cI HEAD`
  of the generator commit, not wall clock.

## 4. Artifact contract

Smoke run output directory (`artifacts/generated/atm-admission-bench/<seed>/`):

| File | Format | Purpose |
| --- | --- | --- |
| `run-manifest.json` | JSON | seed, mode, scenario count, generator commit |
| `results.jsonl` | JSONL | one line per scenario-mode evaluation |
| `summary.json` | JSON | aggregate counters, derived metrics |
| `summary.csv` | CSV | flat per-scenario-mode rows |
| `main-results.md` | Markdown | human-readable summary table |
| `generator-manifest.json` | JSON | provenance (see §5) |

`results.jsonl` row schema (`atm.admissionBenchResult.v1`):

```jsonc
{
  "scenarioId": "01-compose-disjoint-same-file",
  "pack": "agr-benchmark",          // or "agr-conflict-benchmark"
  "mode": "agrOff",                 // or "layer1" | "layer2Adr" | "conflict"
  "composeVerdict": "parallel-safe", // optional
  "brokerVerdict": null,
  "conflictVerdict": null,
  "validatorOutcome": "pass",
  "groundTruth": { "safeToParallelize": true, "validatorShouldCatch": false },
  "expected": { "validatorOutcome": "pass" },
  "matchedExpectation": true,
  "falseSafeRegression": false
}
```

`summary.json` schema (`atm.admissionBenchSummary.v1`):

```jsonc
{
  "seed": 20260625,
  "scenarioCount": 20,
  "modeComparisons": 36,
  "matched": 36,
  "expectationFailures": 0,
  "falseSafeRegressions": 0,
  "unsafeCaughtRate": 1.0,
  "shipSafe": true,
  "packs": {
    "agr-benchmark": { "scenarios": 12, "comparisons": 28 },
    "agr-conflict-benchmark": { "scenarios": 8, "comparisons": 8 }
  }
}
```

`main-results.md` MUST start with the header `# ATM-AdmissionBench v0.1 —
Smoke Results` and include a per-pack table.

## 5. Generator manifest

`generator-manifest.json` schema (`atm.admissionBenchGeneratorManifest.v1`):

```jsonc
{
  "schemaId": "atm.admissionBenchGeneratorManifest.v1",
  "contract": "docs/bench/ATM-AdmissionBench-CONTRACT.md",
  "seed": 20260625,
  "baseCommit": "<git rev-parse HEAD before any bench commit>",
  "generatorCommit": "<git rev-parse HEAD of the commit publishing the bench>",
  "generatedAt": "<commit ISO timestamp>",
  "commands": [
    "npm run typecheck",
    "npm run validate:agr-benchmark",
    "npm run validate:agr-conflict-benchmark",
    "npm run bench:admission:smoke -- --seed 20260625",
    "npm run bench:admission:export-blind -- --seed 20260625",
    "git diff --check"
  ],
  "knownLimitations": [
    "Smoke corpus only — does not exercise CAS re-plan, throughput, or vendor providers.",
    "Validator outcomes are derived from the in-repo deterministic harness, not from running external tools per scenario.",
    "Scenario verdicts are computed by the same code path that the AGR validators gate; this bench measures consistency, not correctness of that code path.",
    "Blind export removes per-mode expected routes but keeps ground-truth labels; auditor must derive expected verdicts independently."
  ]
}
```

The `baseCommit` is the working-tree HEAD before the generator commit; the
`generatorCommit` is the commit that lands the bench (set after-the-fact when
the runner is re-invoked post-commit; the first run records the staging HEAD).

## 6. Blind export

`artifacts/blind-bench/<seed>/` contains:

- `generator-manifest.json` (same schema as §5)
- `results.blind.jsonl` — rows with `expected` field removed
- `summary.blind.json` — top-level counters only, no failure detail lists
- `summary.csv` — verdicts kept, expectation columns blanked
- `main-results.md` — same shape as smoke
- `README.md` — instructions for the auditor

The blind package is deterministic given the same seed and commit.

## 7. Versioning

This contract is frozen at v0.1. Any change to scenario corpus, oracle
interpretation, artifact schema, or runner CLI requires a new contract
version (`v0.2`) and a new fixture manifest. Adding scenarios is permitted
only by appending; removal requires a major bump.
