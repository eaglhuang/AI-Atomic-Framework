# HIST-PAIRS selection rules — trial stage (smoke + Django pilot) — FROZEN v1-trial

Status: frozen 2026-10-09 (Asia/Taipei) BEFORE any smoke/pilot run. SHA-256 of this file and of the
scripts below is recorded in `SELECTION_RULES.sha256`. Any change => new version + DEVIATIONS entry.
Basis: `HISTORICAL_BENCH_PREREG_zh.md` v0.1 (author-approved defaults). Smoke and pilot are TRIAL RUNS (試跑):
they are excluded from formal results and their pairs never enter the main sample.
All results: author-executed, not independently reproduced.

## 1. Data source (Django only at this stage)
- Repo: https://github.com/django/django (BSD-3-Clause), full bare clone over https (no token).
- PR list: GitHub Search API, unauthenticated, `repo:django/django is:pr is:merged merged:<month>` for every
  month 2024-01..2025-12 (24 windows, each < 1000 results). Fields kept: number, title, created_at, closed_at,
  merged_at, user, html_url -> `django_pr_search.jsonl`.
- PR head SHA: `git ls-remote https://github.com/django/django.git 'refs/pull/*/head'` -> `django_pull_heads.txt`;
  heads fetched as `refs/pull/N/head`.
- Window: merged_at in [2024-01-01T00:00:00Z, 2025-12-31T23:59:59Z].

## 2. PR eligibility (`build_pairs.py`, reason code per PR in `pr_eligibility.jsonl`)
- head-unavailable: no `refs/pull/N/head` or not fetchable.
- **mb_X = git merge-base(head_X, main_tip)** where main_tip = upstream main at mining time (recorded in
  build_meta.json). DEVIATION from prereg §3.1(4) (which uses landing_X^1 from merge_commit_sha): the
  unauthenticated search API does not return merge_commit_sha and per-PR API calls (60/h) are infeasible without
  a token. For Django (maintainers re-commit/rebase PRs) merge-base(head, main) is the PR's fork point.
- head-in-main-ff: head is an ancestor of main_tip (fork point undeterminable without merge_commit_sha) -> excluded.
- code patch = `git diff --no-renames --diff-algorithm=histogram mb_X head_X -- <source files>`.
- File classes (first match): test (`tests/ test/ testing/ *_test.py test_*.py conftest.py`), doc
  (`docs/ doc/ *.rst *.md *.txt .github/ changelog* release*notes* AUTHORS*`), vendored, generated
  (`*.min.js *.lock *.po *.mo`, or base header first 5 lines contain `generated`/`DO NOT EDIT` -> skipped),
  binary (numstat `-`), source = remaining `*.py`.
- PR excluded if (source files only): source-file-deleted, mode-change, submodule, base-not-utf8,
  src-file-count not in 1..12, src-lines-gt-400 (added+deleted over source files).
- Test files are kept as the PR's test patch (semantic endpoint only, never a write intent).

## 3. Pairs (`candidates.jsonl` keeps every pair considered + reason code)
1. Both PRs eligible; [created_at, merged_at] intervals overlap.
2. >=1 common source file; shared base b = git merge-base(mb_A, mb_B); common file must exist at b
   (else common-file-not-in-base).
3. Each code patch applies alone to b with `git apply --cached --check` (no fuzz), else `drift`.
4. Intents: `git diff -U0 --diff-algorithm=histogram b tree(b+X)` per file; each hunk = one intent
   (insert/delete/replace), base range, exact pre/post bytes, 3 lines base context each side.
   logical_id = `log:{pair_id}:{pr}:{path}:h{k}`.
5. Stratum by min hunk distance on common files (base coordinates): O1 = intersecting/touching (0),
   O2 = 1..3 lines, O3 = >3 lines. O0 controls are NOT built in the trial stage (prereg pilot is O1/O2/O3).
6. Labels (descriptive only): git_merge_file_clean (merge-file of b+A, b, b+B on every common file),
   gold_apply_clean (A then B both apply with --check onto b).
7. pair_id = `django:{prA}_{prB}` with prA < prB.

## 4. Sampling (`sample_pairs.py`)
- Candidates sorted by (project, pair_id). Max 2 pairs per PR across smoke+pilot (checked in draw order).
- Smoke: numpy Generator(PCG64(20261009)), quotas O1=1, O2=1, O3=2 (4 pairs).
- Pilot: numpy Generator(PCG64(20261008)), quotas O1=O2=O3=10 drawn from the remaining candidates; a
  stratum shortfall is backfilled O1->O2->O3 with PCG64(20261009) (=20261008+1) and recorded.

## 5. Run design (trial)
- Arms: steward, file_lock, occ, git_three_way, bare_composer (definitions: `src/hist/README.md`).
- Writers: 2 OS processes (one per PR) sharing one worktree that contains every source file of both PRs at b
  (git-initialised; ATM registry under .atm/runtime).
- Seeds: seed_{pair,k} = uint32(first 4 bytes, big-endian, of SHA-256("hist-v1|" + pair_id + "|" + k)).
  Smoke: k=0 only. Pilot: k=0,1 (prereg §7.2: 2 seeds). Seed is arm-independent: it fixes writer start
  offsets (0..20 ms), per-file hold (0..30 ms) and file order jitter — identical across arms.
- Oracle: oracle_v2-hist (`src/hist/oracle_hist.mjs`), contract + planted-fault tests in
  `test/hist_oracle_contract.mjs` must pass before any run.
- Semantic endpoint (STALE method): same union test set in every condition; only NEW failures after merging
  are counted (details in `hist-tools/semantic.py`).
- ATM pin: recorded in PINS.json per generation.
