# ATM protected-main CI burn-in baseline

**Observed at:** 2026-09-12T00:06Z  
**Workflow:** `ci.yml` (`ci`)  
**Source:** GitHub Actions run history for `eaglhuang/AI-Atomic-Framework`

## Current measurement

The latest 30 completed `ci.yml` runs contain 14 consecutive successful runs at
the head of the history. The streak begins at run `34632239826` (commit
`d3e82f09999fd4f63ab493b449e0fcc4f5637f80`) and continues through run
`34660413501` (commit `bb5534aff79376616760f75122c9e9f2299f5cd4`). The preceding
16 runs in the same sample are failures.

| Measure | Value |
|---|---:|
| Completed runs sampled | 30 |
| Successful runs | 14 |
| Failed runs | 16 |
| Current consecutive-success streak | 14 |
| Streak start | 2026-09-11T18:15:20Z |
| Streak end | 2026-09-12T00:05:11Z |
| Current streak duration | approximately 5h 50m |

Representative successful runs: `34632239826`, `34641411037`, `34654066656`,
`34656198670`, `34659853949`, `34660154388`, `34660319435`, and
`34660413501`. The complete sample is retained in the command-backed evidence
for this report.

## Interpretation

This is evidence of a repaired CI transition, not proof of long-term green CI.
The 14-run streak is too short to support a reliability claim; the 16 preceding
failures must remain visible in the product narrative. A defensible burn-in gate
should require at least 30 consecutive calendar days (or 90 completed protected
main runs, whichever is later), with zero unexplained failures and a published
failure taxonomy. Until that gate is met, the product claim is **green recently**,
not **long-term green**.

## Reproduction

```text
gh run list --repo eaglhuang/AI-Atomic-Framework --workflow ci.yml --limit 100 \\
  --json databaseId,status,conclusion,headSha,headBranch,createdAt,event,displayTitle \\
  | node --strip-types scripts/measure-product-ci-burn-in.ts --stdin
```

Re-run this command at each burn-in checkpoint and append the raw result digest;
do not overwrite earlier observations.

## Machine-evaluated checkpoint — 2026-09-12T15:58Z

The new offline evaluator is available as `npm run validate:ci-burn-in --
--input <gh-run-list.json>`. It validates newest-first ordering, unique run IDs,
completed status, protected `main` branch, supported events, and explicit
conclusions before evaluating the claim. A short or failed history exits
non-zero and can never be labelled `long-term-green`.

The current GitHub export contains 100 completed Product CI runs. The newest 21
are successful (including 2 release-candidate observations), followed by 79
historical failures; the observed range is 6.115150 days. Therefore the machine
claim is `unexplained-failure`, not `long-term-green`. This is a measurement
improvement, not long-term-green proof. The raw export digest is
`sha256:1577c58723c4533c28bc250117f97a590583c9856ce335ed1efb809eb4f9b1a2` and
must be retained at each checkpoint rather than replacing this observation.
