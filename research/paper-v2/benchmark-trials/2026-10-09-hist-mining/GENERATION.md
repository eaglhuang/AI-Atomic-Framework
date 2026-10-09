# Generation: benchmark-trials/2026-10-09-hist-mining — mining + feasibility only (no runs), excluded from formal results

ATM paper 2.0 (DRAFT). Historical real-PR workload (STALE-style, arXiv:2609.25396 method cited, no STALE data used).
**Author-executed, not independently reproduced.** GitHub CI only checks that these files match SHA256SUMS. No arm runs were
executed in this generation, no main sample was drawn, the main run (~9,750 runs) has NOT started (needs author sign-off).

- Purpose: re-mine candidate pairs for all 6 prereg projects (Django, SymPy, xarray, pytest, Sphinx, FastAPI) with merge-commit
  bases per prereg §3.1(4), using an authenticated read-only GitHub token (token never stored; read from an env var only).
  Fixes trial deviation 1 (no merge SHA without a token; 162 Django fast-forward PRs excluded).
- Selection rules: frozen trial rules unchanged except the base rule (copies + hashes in `scripts/frozen-trial/`); details and
  clarifications in `DEVIATIONS.md`.
- Results (Chinese): `SUMMARY_zh.md`; machine-readable `out/summary_tables.json`, `out/feasibility_dryrun.json`.
- Prereg v1.1 proposal (DRAFT, NOT applied): `PREREG_v1.1_PROPOSAL_zh.md`.

## Key numbers (candidate pairs under the frozen rules)
| project | candidates | O1 (identical / divergent) | O2 | O3 | drift excluded | 50 pairs reachable (feasibility dry-run, max 2/PR) |
|---|---|---|---|---|---|---|
| django | 239 | 0 (0/0) | 8 | 231 | 253 | yes (all O3; the 8 O2 were used by smoke/pilot) |
| sympy | 99 | 6 (5/1) | 2 | 91 | 41 | yes |
| xarray | 568 | 0 | 9 | 559 | 401 | yes |
| pytest | 108 | 0 | 8 | 100 | 59 | yes |
| sphinx | 223 | 1 (1/0) | 4 | 218 | 311 | yes |
| fastapi | 196 | 0 | 2 | 194 | 140 | yes (tightest, greedy capacity 56) |

- O1 same-hunk: 7 in total, 6 of them identical edits; only 1 divergent real same-hunk pair (sympy:27369_27414).
- 1,164 of 1,205 drift exclusions (96.6%): the later PR was rebased onto its partner before merging.
- Diagnostic option P (pre-rebase head) would add 70 divergent O1 pairs (~65 under max 2/PR) — proposal only.
- Not included: per-project `pairs_eligible.jsonl` (upstream source hunks, ~510 MB); SHA-256 listed in MANIFEST.json
  `regenerable_not_included`; rebuilt deterministically by `scripts/build_pairs_merge.py`.

Verify (read-only): `sh verify.sh .` in this directory (or `sh verify.sh <this dir>`).
