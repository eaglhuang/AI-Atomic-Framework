## Mining stage deviations / clarifications vs prereg v0.1 and frozen trial rules (times Asia/Taipei)

1. **2026-10-09 23:20 — Base rule restored to prereg §3.1(4).** With an authenticated GitHub token (read-only, public repos),
   `merge_commit_sha` is now available: `mb_X = git merge-base(head_X, landing_X^1)`. This REVERSES trial deviation 1
   (`merge-base(head, main_tip)` + `head-in-main-ff` exclusion of 162 Django PRs). No other frozen selection rule changed
   (file classes, 1..12 source files, <=400 lines, interval overlap, b = merge-base(mb_A, mb_B), `git apply --check` without
   fuzz, O1/O2/O3 distances, labels). The frozen rules/scripts are copied verbatim in `scripts/frozen-trial/` (sha256 OK).
2. **Clarification: PRs landed as-is (head == merge_commit_sha).** Here `landing^1` lies inside the PR, so the literal formula
   would keep only the last commit. Rule used: `mb_X = head~N` on the first-parent chain, N = PR commit count from the API,
   accepted only if `mb..head` is exactly N non-merge commits; otherwise excluded as `ff-nonlinear` (SymPy 3, xarray 1).
   Applied to 122 PRs (Django 120, SymPy 2).
3. **Prereg §3.1(2) now applied:** PRs whose base branch is not the default branch are excluded (`non-default-base`; e.g.
   pytest backports 269). The trial stage could not apply this (search API has no base ref).
4. **PR snapshot source:** GitHub GraphQL search (`is:pr is:merged merged:<month>`, 24 monthly windows; none reached 1000),
   instead of the REST search API. Same window and filters. Django count identical to the trial snapshot (1,547).
5. **head.sha** = `headRefOid` at snapshot time (prereg §3.1(3)); fetched via `refs/pull/N/head` (or by sha). 0 unavailable.
6. **Not built:** O0 control payloads (count only), main-sample draw (only a labelled feasibility dry-run, `out/feasibility_dryrun.json`).
7. **Diagnostics added (do not affect selection):** per drift pair `drift_side`, `partner_landed_before_base`, `x3` (3-way
   rebase stratum), and the option-P estimate (`v11_prerebase_*`). These exist only to inform the prereg v1.1 decision.
8. **Not included in the sealed folder:** `pairs_eligible.jsonl` per project (hunk payloads containing upstream source, ~510 MB);
   SHA-256 recorded in MANIFEST `regenerable_not_included`; rebuilt deterministically by `build_pairs_merge.py` given the same
   snapshot and upstream objects. Hence no upstream code excerpts in this folder (PR titles/logins are public metadata).
