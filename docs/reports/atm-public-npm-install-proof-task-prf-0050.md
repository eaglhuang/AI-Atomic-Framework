# ATM public npm install proof — TASK-PRF-0050

Generated from clean Windows consumers on Node `v24.12.0`. The candidate
validator packs and installs the candidate tarball directly; the public
validator installs the exact registry tarball. Neither path uses a workspace
link.

## Verdict

**PASS for the candidate boundary contract.** All four required commands ran in
an isolated consumer with no `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, or
`Cannot find module` result. `version` is not sufficient evidence: the receipt
requires `version`, `next`, `tasks`, and `doctor` together.

## Candidate inventory

| Field | Value |
|---|---:|
| Package | `@ai-atomic-framework/cli@0.1.0` (local candidate) |
| Candidate tarball bytes | 734,810 |
| Candidate unpacked bytes | 2,638,544 |
| Candidate entries | 66 |
| Candidate tarball SHA-256 | `d219303ffa217cb981601c6dc0d8fde4084dde25e2c6fec0e049280cdbca208a` |
| Install time (one run) | 1,973.85 ms |
| Workspace link used | `false` |

## Command matrix (three measurement runs for `version`)

| Command | Exit code | Module resolution failure | p50 | p95 |
|---|---:|---|---:|---:|
| `atm --version --json` | 0 | no | 174.38 ms | 187.44 ms |
| `atm next --json` | 1 (governance result) | no | 962.74 ms | 962.74 ms |
| `atm tasks status --task TASK-PRF-0050 --json` | 2 (governance result) | no | 181.18 ms | 181.18 ms |
| `atm doctor --json` | 0 | no | 868.69 ms | 868.69 ms |

The non-zero `next` and `tasks` statuses are expected when the consumer is not
an initialized ATM adopter; they are valid command executions, not loader
failures.

## Published registry command matrix

The fixed public version `@ai-atomic-framework/cli@0.1.0` was installed from
the registry tarball in a clean consumer. The public validator now requires the
same four-command matrix as the candidate validator; a successful `--version`
alone is insufficient.

| Field | Value |
|---|---:|
| Registry tarball SHA-256 | `e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14` |
| Registry unpacked bytes | 3,357,358 |
| Registry entries | 78 |
| Install time (one run) | 2,585.77 ms |
| Module-resolution failures | 0 |
| All commands executed | `true` |

| Command | Exit code | p50 | p95 |
|---|---:|---:|---:|
| `atm --version --json` | 0 | 1,235.12 ms | 1,235.12 ms |
| `atm doctor --json` | 0 | 2,272.82 ms | 2,272.82 ms |
| `atm next --json` | 1 (governance result) | 1,909.12 ms | 1,909.12 ms |
| `atm tasks status --task TASK-PRF-0049 --json` | 2 (governance result) | 1,156.20 ms | 1,156.20 ms |

The public proof was produced with:

```text
npm run validate:public-npm-install -- --package @ai-atomic-framework/cli --version 0.1.0 --measurement-runs 1
```

## Baseline comparison

The retained baseline-vs-candidate receipt is outside Git history at:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0049-current-pack\baseline-vs-candidate-measurement.json`.

| Field | Published baseline `0.1.0` | Candidate | Delta |
|---|---:|---:|---:|
| Unpacked bytes | 3,357,358 | 2,638,544 | −718,814 (−21.41%) |
| Entries | 78 | 66 | −12 (−15.38%) |
| Tarball bytes | 930,492 | 734,810 | −195,682 |
| Tarball SHA-256 | `e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14` | `d219303ffa217cb981601c6dc0d8fde4084dde25e2c6fec0e049280cdbca208a` | — |

The measured reduction clears the 20% byte and 15% entry thresholds. The
baseline and candidate smoke exit statuses match, and the candidate has zero
module-resolution failures.

## Reproduction

```text
npm run validate:candidate-npm-install -- --measurement-runs 3
node --strip-types tests/cli/cli-published-command-smoke.test.ts
node --strip-types tests/cli/public-npm-install-contract.test.ts
npm run validate:public-npm-install -- --package @ai-atomic-framework/cli --version 0.1.0 --measurement-runs 1
```

Receipt schema: `atm.candidateNpmInstallProof.v1`.

## Scope and rollback

Scope is limited to the candidate validator, runtime boundary/build contracts,
CLI package smoke tests, and this report. The change is reversible with the
single governed delivery commit for TASK-PRF-0050; no npm publish, registry
metadata mutation, paid pilot, hidden oracle change, or CI-policy weakening is
part of this proof.
