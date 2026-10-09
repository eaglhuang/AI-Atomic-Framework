## Deviations / clarifications — prereg v1.1 freeze and main-sample draw (times Asia/Taipei)

1. **2026-10-10 00:08–00:13 — option-P candidate pool built before the prereg text was written.** `scripts/build_pairs_v11p.py`
   (frozen, sha256 in FREEZE_RECEIPT.txt) was run on all 6 projects before `PREREG_v1.1_zh.md` was written; no sample was drawn
   before the freeze receipt (00:13:09). The first invocation crashed on a Python keyword clash (`done(reason=...)`) before writing
   any output; the one-line fix (rename of the parameter) does not change any rule. The frozen file is the fixed version.
2. **Option-P counts differ slightly from the proposal estimate in xarray only** (O1 divergent 23 vs 21, O3 120 vs 118, drift 119 vs
   118): the estimate script (`v11_prerebase_estimate.py`, mining generation) used a simplified file rule; the frozen builder applies
   every v1.0 PR-level rule (generated-header files not counted, histogram numstat, deleted/mode/submodule/utf8). Other projects match
   the estimate exactly. Total O1 divergent from P: 72 (estimate 70).
3. **Sphinx O1 = 18 (> quota 17).** The O1 quota phase took 17; the shortfall backfill (prereg v1.0 §4.1 order O1 -> O2 -> O3) then
   took 1 more O1 before O3. This is the frozen procedure, reported as is.
4. **ATM pin = 20effd45 (main at freeze) instead of b35a6141 (pilot pin).** `packages/core` is byte-identical between the two
   (`diff -rq` over packages/, only packages/cli differs: PR #241 `--files-from`); recorded in PINS.json.
5. **O0 control payloads** are built here (count only in the mining generation): 5 per project, PR cap shared with the main
   sample, both v1.0 patches must apply to b = merge-base(mb_A, mb_B) (`o0_log` per project in sample_main.json).
6. **Upstream code included** (approved Q3 default) as gzip'd payloads with `licenses/` and `NOTICE.md`. The full per-project
   candidate payloads (`pairs_eligible.jsonl`, ~510 MB; `v11p_pairs_eligible.jsonl`) are NOT included; their sha256 are in
   FREEZE_RECEIPT.txt and they are regenerable from the mining generation + public upstream history.
7. **Semantic endpoint environments** (6 projects) are not part of this freeze; per-project environment and test-runner details
   will be recorded in the main-run generation's DEVIATIONS (rule fixed here: STALE scoring, final/final base-valid pairs only).
8. **GitHub token** was used only via the environment during mining (2026-10-09). This freeze made no API call; no token value is
   in any file (grep-checked before packaging).
