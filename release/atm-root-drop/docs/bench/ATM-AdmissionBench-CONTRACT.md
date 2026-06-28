# ATM-AdmissionBench — Frozen Contract

Status: **frozen**. Contract version **0.2**, 2026-06-25.
Versions covered by this document:

- **v0.1 smoke** — deterministic admission-rule smoke gate over the AGR +
  AGR-conflict scenario packs. Frozen 2026-06-25 in commit
  `3eec69a73a04112e2af8d3630c32138c37143eab`.
- **v0.2 paper profile** — formal frozen extension over the v0.1 corpus that
  adds baseline policy comparison, ablation, adversarial fault model,
  forwarding summary, unresolved exclusion rule, and paper table generation.
  v0.2 reuses the v0.1 corpus as the main-stat denominator.

> The bench does **not** prove ATM correct. It only checks that the
> documented admission rules, validators, baseline policy models, ablations,
> adversarial fault model, and oracle expectations agree on a fixed scenario
> corpus, and emits machine-readable artifacts.

## 1. Authority and forbidden actions

- The contract is authoritative. Runner, fixtures, oracle, validators, and
  baseline policy implementations MUST match every clause below.
- v0.2 does NOT claim to be the future full benchmark over Core-12 + 60
  variants + external corpus. That future release is reserved for v1.0.
  v0.2's claim is narrower but formal: frozen paper profile over the v0.1
  corpus, with baseline comparison, ablation, adversarial fault model,
  forwarding summary, unresolved exclusion rule, and paper table generation.
- Generator MUST NOT:
  - Modify `docs/reviews/**` or `artifacts/audit/**`.
  - Modify paper claims, result tables, or downstream evidence files
    outside `artifacts/generated/atm-admission-bench/**` and
    `artifacts/blind-bench/**`.
  - Encode expected per-scenario routes inside validators.
  - Backfill the oracle from ATM output; if ATM output differs from the
    oracle, the benchmark records a failure.
  - Silently weaken existing validators to make cases pass.
  - Mix field evidence into the policy baseline denominator.

## 2. Scenario corpus (v0.1 frozen)

The corpus is the frozen v0.1 set:

- `scripts/fixtures/agr-benchmark/manifest.json` — 12 scenarios.
- `scripts/fixtures/agr-conflict-benchmark/manifest.json` — 8 scenarios.

Plus the bench fixture manifest
`scripts/fixtures/atm-admission-bench/manifest.json` which records the
profile/track configuration, policy/ablation/adversarial enumeration, and
denominator rule. Smoke selection is **all scenarios from both packs**.

Frozen denominator for v0.2:

- 20 scenarios (12 + 8).
- 42 mode comparisons (compose × {agrOff, layer1, layer2Adr} plus
  conflict-pack mode).
- seed 20260625.

Each scenario carries its own `groundTruth` (`safeToParallelize`,
`validatorShouldCatch`). The oracle is read-only and shared across smoke and
paper profiles.

## 3. Profile / track CLI surface

Entry point: `scripts/run-atm-admission-bench.ts`.

```
node --strip-types scripts/run-atm-admission-bench.ts \
    [--profile smoke|paper] \
    [--track all|policy|ablation|adversarial|forwarding|field|report] \
    [--mode smoke|export-blind] \
    [--seed <uint>] \
    [--out <directory>]
```

Defaults:

- `--seed 20260625`, `--profile smoke`, `--track all`, `--mode smoke`.
- Smoke output: `artifacts/generated/atm-admission-bench/<seed>/` (legacy
  `smoke`) or `artifacts/blind-bench/<seed>/` (`export-blind`).
- Paper output: `artifacts/generated/atm-admission-bench/<seed>-paper/`.

Legacy compatibility: `--mode smoke` and `--mode export-blind` remain valid
without `--profile`; they preserve the v0.1 surface byte-for-byte.

Tracks:

- `policy` — run six baseline policies (see §5).
- `ablation` — disable one ATM feature per variant and compare against
  atm-full baseline (see §6).
- `adversarial` — apply five adversarial faults and observe whether ATM
  enforcement holds (see §7).
- `forwarding` — summarise admission → apply / validator / human forwarding;
  field evidence MUST NOT be mixed into the baseline denominator.
- `field` — read an optional `artifacts/field-evidence/admission/summary.json`
  if present; if absent, all field fields are reported as `not-applicable`.
- `report` — re-render `paper-tables.md` from existing artifacts without
  re-running benchmark logic.
- `all` — orchestrates `policy`, `ablation`, `adversarial`, `forwarding`,
  `field` in one run.

`scripts/render-atm-admission-report.ts` provides a standalone re-render
entry point used by `npm run bench:admission:report`.

Determinism rules:

- Seed is recorded in every manifest. The runner is deterministic; the seed
  gates any non-deterministic future extensions only.
- Scenario ordering is manifest order; mode ordering inside a scenario is
  its declared `relevantModes`.
- `generatedAt` is derived from `git show -s --format=%cI HEAD` of the
  generator commit, not wall clock.

## 4. Oracle, unresolved, and primary denominator

The oracle is the per-scenario `groundTruth` plus the declared expected
verdict for each mode. Rules:

- Every primary-metrics scenario MUST have a reliable oracle. A scenario is
  reliable when its `expected` matches the in-repo ATM verdict at frozen
  v0.1; this is enforced by `validate:agr-benchmark` and
  `validate:agr-conflict-benchmark`.
- Cases without a reliable oracle go into `scripts/fixtures/atm-admission-bench/unresolved.json`
  and MUST NOT enter primary metrics. They are surfaced in the run's
  `unresolved-set.json`.
- Primary denominator = (v0.1 mode-comparison count) − (unresolved size).

## 5. Policy baseline comparison

Six fixed policies (`scripts/lib/admission-bench/policies.ts`):

| Policy | Description | Real tool? |
| --- | --- | --- |
| `direct` | Admit unconditionally. | no (model) |
| `git-diff3` | Block on text-range overlap, otherwise admit. | no (model) |
| `file-serial` | Serial on any same-file write. | no (model) |
| `file-occ` | Same-file → merge-with-tool; otherwise admit. | no (model) |
| `text-range` | Same-file + overlapping ranges → serial. | no (model) |
| `atm-full` | In-repo ATM verdict (`runAgrBenchmarkScenario` / `evaluateConflictScenario`). | yes (in-repo) |

`direct`, `git-diff3`, `file-serial`, `file-occ`, and `text-range` are
deterministic baseline models — they are NOT real external tool executions.

Per-row schema (`atm.admissionBenchPolicyRow.v1`): `policy`, `scenarioId`,
`pack`, `family`, `mode`, `route`, `admitted`, `caughtPhase`, `falseSafe`,
`overSerialized`, `intentPreserved`, `oracleVerdict`, `routeMatchedOracle`.

Per-policy aggregate (`atm.admissionBenchPolicyAggregate.v1`): `policy`,
`scenarios`, `falseSafe`, `overSerialization`, `routeF1`,
`intentPreservation`, `p95LatencyNs`.

`p95LatencyNs` is the string literal `not-measured` unless a real timing
source is added.

## 6. Ablation

Seven fixed ablations (`scripts/lib/admission-bench/ablation.ts`):

`no-cid`, `no-shared-surface`, `no-rw-dependency`, `no-virtual-atom`,
`no-conflict-key`, `no-cas`, `no-fallback-lock`.

Each variant declares a set of affected scenario families. For scenarios in
an affected family the variant degrades the ATM verdict to `admit-parallel`
to simulate disabling that feature; other scenarios are untouched.

Aggregate (`atm.admissionBenchAblationAggregate.v1`): `variant`,
`deltaFalseSafe`, `deltaOverSerialization`, `deltaE2ESuccess`,
`mainAffectedFamilies`.

## 7. Adversarial fault model

Five fixed faults (`scripts/lib/admission-bench/adversarial.ts`):

`dropped-read-set`, `dropped-write-surface`, `wrong-conflict-key`,
`shrunk-range`, `all-conflict-dos`.

For each (scenario, fault), the bench produces an `AdversarialRow` recording
whether `atm-full` caught the unsafe case both at baseline and under the
fault, plus a classification:
`enforcement-held` / `silent-miss` / `over-conservative` / `oracle-degraded`.

## 8. Forwarding and enforcement boundary

Forwarding summary (`atm.admissionBenchForwardingSummary.v1`): per-route
counts of admission-forwarded decisions, decomposed into apply / validator /
human. Field evidence (`artifacts/field-evidence/admission/summary.json`) is
read iff present and its path is recorded; otherwise the field source is
`not-applicable`. The summary explicitly records
`fieldEvidenceMixedIntoBaseline: false`.

Enforcement boundary aggregate (`atm.admissionBenchEnforcementRow.v1`): rows
`unsafe-input`, `safe-input`, `mixed`, `adversarial-input` with columns
`admissionCaught`, `applyCaught`, `validatorCaught`, `silentMiss`, `total`.
All empty cells in generated tables MUST be rendered as `not-applicable`
(not blank).

## 9. Artifact contract

Smoke profile (unchanged from v0.1; output dir
`artifacts/generated/atm-admission-bench/<seed>/` and
`artifacts/blind-bench/<seed>/`):

- `run-manifest.json`, `results.jsonl`, `summary.json`, `summary.csv`,
  `main-results.md`, `generator-manifest.json` (smoke).
- Blind variant retains v0.1 schema (`results.blind.jsonl`,
  `summary.blind.json`, etc.).

Paper profile (`artifacts/generated/atm-admission-bench/<seed>-paper/`):

| File | Format | Purpose |
| --- | --- | --- |
| `run-manifest.json` | JSON | seed, profile, track, denominator |
| `results.jsonl` | JSONL | one line per policy / ablation / adversarial row |
| `policy-comparison.csv` | CSV | flat per-scenario × policy rows |
| `ablation.csv` | CSV | per-scenario × ablation rows |
| `enforcement-boundary.csv` | CSV | enforcement boundary aggregate |
| `summary.json` | JSON | aggregated counters and per-policy / per-ablation aggregates |
| `main-results.md` | Markdown | human-readable headline |
| `paper-tables.md` | Markdown | exactly three paper tables (§10) |
| `unresolved-set.json` | JSON | unresolved entries excluded from primary metrics |
| `generator-manifest.json` | JSON | provenance (see §11) |

No generated CSV or Markdown row may contain a blank cell. Empty values MUST
be `not-measured`, `not-applicable`, or `unresolved`.

## 10. Paper-tables.md

`paper-tables.md` MUST contain **exactly three** paper-facing tables, in
this order:

1. **Policy Comparison** — one row per policy with columns
   `Policy | Scenarios | False-safe | Over-serialization | Route F1 |
   Intent preservation | p95 latency`.
2. **Ablation** — one row per variant with columns
   `Variant | Δ false-safe | Δ over-serialization | Δ E2E success |
   Main affected families`.
3. **Enforcement and Trust Boundary** — one row per condition with columns
   `Condition | Admission caught | Apply caught | Validator caught |
   Silent miss | Total`.

The detailed scenario × policy matrix MUST NOT appear in `paper-tables.md`;
it lives in `policy-comparison.csv` and `results.jsonl`.

## 11. Generator manifest

`generator-manifest.json` schema
(`atm.admissionBenchGeneratorManifest.v1`):

```jsonc
{
  "schemaId": "atm.admissionBenchGeneratorManifest.v1",
  "contract": "docs/bench/ATM-AdmissionBench-CONTRACT.md",
  "contractVersion": "0.2",
  "profile": "smoke" | "paper",
  "track": "all" | "policy" | "ablation" | "adversarial" | "forwarding" | "field" | "report",
  "seed": 20260625,
  "baseCommit": "<git rev-parse HEAD before any bench commit>",
  "generatorCommit": "<git rev-parse HEAD of the commit publishing the bench>",
  "generatedAt": "<commit ISO timestamp>",
  "commands": [...],
  "knownLimitations": [...]
}
```

## 12. Versioning

Contract major bumps (v0.x → v1.0) are required when changing the scenario
corpus, oracle interpretation, policy enumeration, ablation enumeration,
adversarial fault enumeration, primary denominator rule, or paper-table
shape. Adding new scenarios, policies, ablations, or faults is append-only
within a major version. v0.2 freezes the policy / ablation / adversarial
enumerations listed above.
