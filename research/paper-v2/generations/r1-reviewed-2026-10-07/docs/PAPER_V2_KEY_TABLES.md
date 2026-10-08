# PAPER_V2_KEY_TABLES — ATM 論文 v2.0 關鍵數據表

| 欄位 | 內容 |
|------|------|
| 彙整日期 | 2026-10-07（Asia/Taipei） |
| 用途 | 給 `PAPER_V2_DRAFT_PACK.md` §6 引用的數字表；**所有數字抄自來源檔，未重算**（標「推算」者為本包以來源數字相除所得） |
| 標籤 | 🟢 **論文可用**（可當主結果，仍須帶本表 caveat）· 🟡 **有 caveat**（可當輔助／動機／附錄，勿當主結果）· 🔴 **勿用於主張**（語意已過期或為 harness artefact） |

共同 harness 背景：atm-bench `0.3.0-latency`，Node v24.21.0（nvm），僅本 box；agent 為 in-process async worker（除 T7／T8 的 multi-process 臂）；hold 20–60 ms 為模擬思考時間（非真 LLM）；writer 預設 `sync`（同步 read-modify-write ＝ 理想 composer/rebase）。

---

## T1 🟢 #180 冷檔原生 queue：正確性 × 延遲（主表）

- 來源：`runs/v017-q180/summary.md`（＝`analyze.out`）、`PAPER_V2_EXPERIMENT_NOTES.md` §2.1
- run-id：`v017-q180-{control,native,nqwait}-a{8,16}-r{1,2,3}`；matrix 2026-10-07 11:33:20–11:35:49 CST（`run_q180.log`）
- ATM：tag **v0.1.17**（commit `8dd6a1c6`），`ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`
- 設定：`seed=42`, `trials=60`, `hot_ratio=0`, `overlap=cold-same-file`, `cold_policy=queue`, `queue_timeout_ms=15000`, real 臂 `cold_atom_identity=region`；每臂 ×3 reps
- 臂：control（無 ATM）／native（`--cold-retry once`，無 loop overlay）／nqwait（`--cold-retry native-queue`，持續等 `queue`∣`true-conflict` 直到 grant/timeout）

| arm | agents | wall ms | vs ctrl | thr int/s | goodput pass/s | waited frac | wait p50/p95/max (ms) | commits/pass/lost per rep | reject/timeout |
|---|---|---|---|---|---|---|---|---|---|
| control | 8 | 3024.78 | 1× | 145.8 | 20.5 | 0 | — | 441/62/**379** | 0/0 |
| native (once) | 8 | 4299.97 | **1.42×** | 102.57 | 102.57 | 0.689 | 25/55/70 | 441/441/**0** | 0/0 |
| **nqwait** | 8 | 6208.2 | **2.05×** | 71.04 | 71.04 | 0.559 | 62/259/350 | 441/441/**0** | 0/0 |
| control | 16 | 3027.87 | 1× | 290.3 | 21.14 | 0 | — | 879/64/**815** | 0/0 |
| native (once) | 16 | 5873.42 | **1.94×** | 149.66 | 149.66 | 0.889 | 29/60/85 | 879/879/**0** | 0/0 |
| **nqwait** | 16 | 9416.48 | **3.11×** | 93.35 | 93.35 | 0.705 | 105/343/637 | 879/879/**0** | 0/0 |

推算（本包）：control lost 率 a8 = 379/441 ≈ **85.9%**、a16 = 815/879 ≈ **92.7%**；nqwait goodput / control goodput：a8 ≈ 3.47×、a16 ≈ 4.42×。

Caveat（必附）：0 lost 綁 sync writer；等待是 harness 對 activeIntent file-blocker 的輪詢＋re-eval，**未**呼叫 `enqueueSerialIntent`、**未**驗證耐久 FIFO ticket；`queue_position` 在 nqwait 臂為常數 1/1/1，非官方 FIFO 序號。

## T2 🟢 #180 最壞同檔（cold-one-file，a16 ×1）

- 來源：同 T1；run-id `v017-q180-1f-{control,native,nqwait}-a16-r1`

| arm | wall ms | vs ctrl | waited frac | wait p50/p95/max | commits/pass/lost | queue_rounds mean/p95/max |
|---|---|---|---|---|---|---|
| control | 3030.19 | 1× | 0 | — | 879/61/818 | — |
| native (once) | 5549.11 | 1.83× | 0.997 | 22/56/68 | 879/879/0 | —（queue_position mean 6.79, max 15） |
| **nqwait** | **40368.98** | **13.32×** | 0.999 | **679/759/794** | 879/879/0 | 14.55/15/15 |

Caveat：n=1 rep；單 process；wall ≈ Σhold＋每筆 ~5 ms ATM 成本（完全串行的理論預期，見 T4 驗算）。

## T3 🟢 #180 disposition / queue 行為與 wait 直方圖

- 來源：`runs/v017-q180/summary.md`「wait_ms histogram」「Decision / queue_rounds」；`PAPER_V2_EXPERIMENT_NOTES.md` §2.3

| arm | decision_hist（3 reps 合併） | atm_first_disposition | queue_rounds mean/p95/max |
|---|---|---|---|
| native a8 | admit 1323 | （enqueue 事件見 `queue` ×299/441 ≈68%，來源 NOTES §2.3） | once → ≤1 輪 |
| nqwait a8 | cold_queue 740 · admit 583 | queue 740 / direct 583 | 2.37/6/7 |
| nqwait a16 | cold_queue 1859 · admit 778 | queue 1859 / direct 778 | 3.26/8/15 |
| nqwait 1-file | cold_queue 878 · admit 1 | queue 878 / direct 1 | 14.55/15/15 |

wait_ms 直方圖（筆數）：

| arm | 0 | (0,25] | (25,50] | (50,100] | (100,200] | (200,400] | (400,800] |
|---|---|---|---|---|---|---|---|
| native a8 | 411 | 458 | 360 | 94 | 0 | 0 | 0 |
| nqwait a8 | 583 | 158 | 151 | 171 | 163 | 97 | 0 |
| native a16 | 293 | 1028 | 998 | 318 | 0 | 0 | 0 |
| nqwait a16 | 778 | 281 | 258 | 362 | 520 | 374 | 64 |
| nqwait 1-file | 1 | 0 | 1 | 1 | 5 | 12 | 859 |

## T4 🟡 Oct 6 冷檔串行成本（core@0.1.2，harness overlay）

- 來源：`COLD_QUEUE_LATENCY.md` TL;DR／§3；`runs/cold-queue/summary.{json,md}`；run-id `cq-*`、`cq1-*`；runs 2026-10-06 17:52–17:57
- ATM：`@ai-atomic-framework/core@0.1.2`（`/workspace/AI-Atomic-Framework`，HEAD `ed317820`），**當時原生 `queue` 不可達**
- 設定同 T1，但 real = `--cold-atom-identity region --cold-retry loop`（ATM 判 `true-conflict`，harness 等 blocker 再重問）

| 情境 | wall ATM/ctrl ms | slowdown | total_ms mean(p95) ATM vs ctrl | waited p50/p95/max | thr int/s | lost/rep |
|---|---|---|---|---|---|---|
| real a8 | 6155/3025 | 2.03× | 95.7(272.8) vs 40.3(59.1) | 63/268/342 | 71.7 vs 145.8 | 0 vs 379 (86%) |
| real a16 | 9571/3028 | 3.16× | 144.0(367.8) vs 40.2(58.3) | 111/363/652 | 91.8 vs 290.3 | 0 vs 815 (93%) |
| mock a8 | 5436/3025 | 1.80× | 86.1(253.8) | 53/241/300 | 81.1 | 0 |
| mock a16 | 7990/3028 | 2.64× | 121.8(306.9) | 93/297/559 | 110.0 | 0 |
| real 1-file a16 | 39962/3029 | 13.2× | 700.6 vs 40.2 | 669/754/791 | 22.0 vs 290.2 | 0 vs 819 |
| mock 1-file a16 | 35671/3029 | 11.8× | 628.7 | 601/680/721 | 24.6 | 0 |

其他可引用事實：ATM 自身 broker_ms ≈ 2.5–2.7 ms、apply_ms ≈ 2.3–2.4 ms（≈5 ms/intent，佔 overhead ~5–10%）；1-file 驗算 Σhold 35.2 s＋Σ(broker+apply) 4.6 s = 39.8 s ≈ 實測 40.0 s；overlay 非 FIFO（thundering herd），queue_rounds 平均 a8 2.4／a16 3.3／1-file 14.6；goodput ATM 為 control 的 3.5×／4.3×。

用途：**動機與「同量級」對照**（T1 nqwait a8 2.05× vs 此 2.03×；1-file 13.32× vs 13.2×）。**不可**當 v0.1.17 原生 queue 成本；機制不同（true-conflict overlay vs 原生 queue）。

## T5 🔴 V017 cold matrix 主臂（region + `loop`）— 勿當 queue cost

- 來源：`V017_HOT_COLD.md` §2；`runs/v017/cold_summary.md`；run-id `v017-cq-*`；2026-10-07 07:28–07:30 CST

| 情境 | Oct 6 | v0.1.17（loop） | 說明 |
|---|---|---|---|
| real a8 wall / vs ctrl | 6155 / 2.03× | 3393.93 / 1.12× | loop 對 `queue` 立刻 grant → wait=0，wall 虛短 |
| real a8 first disposition | true-conflict 707 / direct 616 | **queue 1096 / direct 227** | ✅ 可引用為「v0.1.17 改回原生 queue」的證據 |
| real a16 wall / vs ctrl | 9571 / 3.16× | 6639.03 / 2.19× | 同上 |
| real 1-file a16 | 39962 / 13.2× | 7354.3 / 2.43× | 同上 |
| legacy（unique atomId）a8 | composer_merge 383＋admit 58；wait 0 | admit 441；waited 65%（p95 56 ms）；wall 4459.09 / 1.47× | composer 舊路徑退場；語意已變 |
| legacy a16 | composer_merge 798＋admit 81 | admit 879；waited 88%（p95 64 ms）；wall 7026.09 / 2.32× | 同上 |
| probe `v017-cq-probe-noloop-a8`（once） | — | wall 4514 ms、mean wait 20.6 ms、最終全 admit/direct | 弱證據（後被 T1 native 臂取代） |

唯一可用部分：**first disposition 由 true-conflict 變 queue**（質性證據）。wall／wait 數字一律不得引用為成本。

## T6 🟢 熱檔 admission（h1-a8 主表；Oct 6 core@0.1.2 vs v0.1.17）

- 來源：`HOT_FILE_LATENCY.md` TL;DR／§2.2（Oct 6，`runs/hot-file/summary.{json,md}`，run-id `hf-*`，19:28–19:30）；`V017_HOT_COLD.md` §3（v0.1.17，`runs/v017/hot_summary.md`，run-id `v017-hf-*`，07:30–07:33）
- 設定：`seed=42`, `trials=50`, `overlap=high`, hot_ratio 1.0, 8 agents, 354 intents/rep, ×3

| arm | 指標 | Oct 6 (core@0.1.2) | v0.1.17 |
|---|---|---|---|
| control | wall；lost 率 | 2522；71.5% | 2521；71.5% |
| **native** | wall（vs ctrl）；reject/rep；lost；成功率 | 2549（1.01×）；84（23.7%）；0；76.3% | 2557；86.7；0；75.5% |
| **loop**（hot-retry overlay） | wall；reject；lost；成功率；waited p95 | 2908（1.15×）；0；0；100%；61 ms | 3037；0；0；100%；52 ms |
| nativestale（無 composer apply） | lost 率 | 64.9% | 65.0% |
| loopstale | lost 率 | 65.2% | 63.6% |
| mock（參考） | 成功率 | 79.6% | 79.5% |

Oct 6 其他情境（`HOT_FILE_LATENCY.md` §2.2）：

| 情境 | arm | wall（vs ctrl） | rejects/rep | lost/rep | 成功率 | goodput/s（vs ctrl） | overhead mean/p95 |
|---|---|---|---|---|---|---|---|
| h1-a8 | native | 2549（1.01×） | 84 | 0 | 76.3% | 105.9（2.6×） | 4.21/6.75 |
| h1-a8 | loop | 2908（1.15×） | 0 | 0 | 100% | 121.8（3.0×） | 13.4/47.9 |
| h1-a6 | native | 2549（1.01×） | 59 | 0 | 78.1% | 82.4（2.1×） | 4.38/6.93 |
| h1-a6 | loop | 2783（1.10×） | 0 | 0 | 100% | 96.7（2.5×） | 11.6/43.0 |
| h08-a8 | native | 2570（1.02×） | 68 | 0 | 80.8% | 111.3（2.5×） | 4.53/7.02 |
| h08-a8 | loop | 2768（1.10×） | 0 | 0 | 100% | 127.9（2.8×） | 10.3/45.1 |

同區重疊 pairs/rep（h1-a8）：control ~299–300、native ~150–156、loop ~167–176（`runs/hot-file/overlap.json`、`runs/v017/overlap.out`）；native/loop 的同區重疊**全部**是 composer_merge＋composer_merge。

**勘誤／分母註（A4，2026-10-07；不改上表數字）**：h1-a8 nativestale「172.7（64.9%）」的 **64.9% = lost／commits**（3 reps ratio-of-sums `518/798`；欄位名 `lost_update_rate_of_commits`），不是 lost／354 intents。審閱試算 `172.7/354≈48.79%` 為 **lost／offered** 另一讀法，**不得**替換 64.9%。每 run 整數與聚合法見 `T6_R1_DENOMINATOR_AUDIT.md`、`runs/hot-file/t6_r1_raw_counts.json`。

Caveat：native 0 lost 與 loop 100% **綁 sync writer**；stale writer 55–65% lost（≈control）→ ATM 准入本身不保證無 lost update，需 composer apply。loop 是 **harness overlay**（core 無 park/rearbitrate 協定）。可主張：「熱檔准入每筆成本小（wall 1.01–1.02×、~4–5 ms/intent）」；「原生會 reject 17–24%」。不可主張：「ATM 原生熱檔 100% 成功」。

## T7 🟢 ATM 每筆成本（paced vs unpaced；core@0.1.2）

- 來源：`COMPARE_LATENCY.md`；`runs/compare/{paced_rep1,paced_5rep,unpaced_5rep}.{md,json}`；run-id `small-{atm,control}-seed42[-r2..r5]`、`unpaced-*-seed42-r1..r5`；6 agents × 30 trials, hot 0.4, overlap med, 168 intents/rep

| 情境 | wall ATM/ctrl ms | slowdown | thr int/s ATM/ctrl | total mean/p95 ATM vs ctrl | overhead mean/p95 | goodput ATM/ctrl |
|---|---|---|---|---|---|---|
| paced ×5 | 1560.05/1516.23 | **1.03×** | 107.69/110.80 | 44.96/64.81 vs 40.58/58.44 | 5.21/7.14 vs 0.2/0.29 | 103.08/71.1（1.45×） |
| unpaced ×5 | 747.27/81.73 | **9.14×** | 225.35/2056.53 | 15.43/20.85 vs 1.45/2.00 | 4.29/6.03 vs 0.09/0.18 | 216.7/1493.43（0.15×） |

拆解（paced ×5）：latency_ms 2.92/4.34（p95）、apply_ms 2.2/3.55；reject 最便宜（latency p50 0.83 ms）。冷熱 overhead p50：cold 5.18／hot 5.13 ms。

COMPARE_SMALL（rep1, `small-atm-seed42`）：ATM 0 lost／95.8% 成功 vs control 60 lost／64.3%；racy_overwrite 0 vs 63；disposition `compose=62, direct=61, proposal-required=38, true-conflict=7`（`COMPARE_SMALL.md`）。

Caveat：單 process 共用 event loop；unpaced 為最壞上界；本組 wait_ms 全 0（未觸發冷排隊）；core@0.1.2 非 v0.1.17。

## T8 🟢 Multi-process（共用 worktree＋registry，CAS；core@0.1.2）

- 來源：`MULTIPROCESS_SMALL.md`；`runs/multiprocess/summary.{json,md}`；run-id `mp-A-*`、`mp-B-*`；2026-10-06 19:31–19:33

| scenario / arm | wall ms | commits/rep | lost/rep | rejects/rep | overhead mean/p95 | registry 殘留 |
|---|---|---|---|---|---|---|
| A control sp / 6 procs | 1516.6 / 1516.2 | 168 / 168 | 59.7 (35.5%) / 60.0 (35.7%) | 0 | 0.20/0.30 · 0.45/0.64 | — |
| A ATM sp | 1538.6 | 160.3 | 0 | 7.7 | 4.98/6.62 | — |
| A ATM 6 procs（CAS） | 1549.5 | 160.7 | **0** | 7.3 | **9.35/19.69** | 0 |
| B control sp / 8 procs | 2024.0 / 2024.1 | 282 | 201 (71.3%) | 0 | 0.18/0.30 · 0.44/0.62 | — |
| B ATM 8 procs（CAS） | 2039.0 | 203 | **0** | 79 | 8.69/21.63 | 0,0,0 |
| B ATM＋hot loop 8 procs | 2448.6 | 282 | 0 | 0 | 21.7/66.1 | 0,0,0 |
| ⚠ B naive registry 8 procs | 2132.1 | 195.7 | 0 | 86.3 | 14.6/36.3 | **37, 26, 32**（殭屍 lease） |
| ⚠ B apply-lock off 8 procs | 2040.2 | 202.7 | **2 (1.0%)** | 79.3 | 8.68/21.3 | 0,0,0 |

A 6 procs registry：328.7 txns/rep、154.7（47%）至少重試一次、CAS conflict 478.7（lock-busy 444 / stale 34.7）、單筆最多重試 14。

用途：負面對照（naive registry、apply-lock off）可寫成「為何 CAS 協定與 apply 互斥是必要」的系統論點。

## T9 🟢 Scale prelude（8 agents × 200／1000 trials；core@0.1.2）

- 來源：`SCALE_PRELUDE.md`；`runs/scale/summary.{json,md}`；run-id `sc-S{1..4}-*`；2026-10-06 19:33:49–19:38:22

| 情境 | arm | wall ms（vs ctrl） | goodput pass/s | 成功率 | lost | rejects | overhead mean/p95/max |
|---|---|---|---|---|---|---|---|
| S1 200t | control sp | 10015 | 83.8 | 57.9% | 611.5 (42.1%) | 0 | 0.18/0.26/0.84 |
| S1 | ATM sp ×2 | 10049（1.003×） | 134.7（1.61×） | 93.3% | 0 | 97 | 4.84/6.50/11.4 |
| S1 | ATM 8 procs ×2 | 10100（1.008×） | 132.2（1.58×） | 92.0% | 0 | 116 | 10.13/22.9/50.5 |
| S2 hot1.0+loop | control sp | 10026 | 41.1 | 29.0% | 1010 (71.0%) | 0 | — |
| S2 | ATM+loop sp | 11251（1.12×） | 126.4（3.1×） | 100% | 0 | 0 | 13.3/48.9/113 |
| S2 | ATM+loop 8 procs | 11641（1.16×） | 122.2（3.0×） | 100% | 0 | 0 | 21.2/66.2/187 |
| S3 1000t (7244 intents) | control sp | 50015 | 84.7 | 58.5% | 3008 (41.5%) | 0 | — |
| S3 | ATM sp | 50054（1.001×） | 133.9（1.58×） | 92.5% | 0 | 540 | 4.77/6.45/20.3 |
| S3 | ATM 8 procs | 50058（1.001×） | 132.6（1.57×） | 91.6% | 0 | 605 | 9.35/20.9/78.4 |
| S4 unpaced | control sp | 529 | 1889 | 68.9% | 451 (31.1%) | 0 | — |
| S4 | ATM sp | 6152（11.6×） | 224 | 94.8% | 0 | 75 | 4.13/5.63/14.5 |
| S4 | ATM 8 procs | 5184（9.8×） | 259 | 92.5% | 0 | 109 | 25.4/87.3/200 |

穩定性：S3 50 s 無退化（overhead p50 4.75–5.01 ms）；S2 schedule_lag p95 322→1215 ms（sp）持續上升＝hot loop overlay unbounded backlog 前兆；S4 8 procs 80% txns 重試、單筆最多 72 次。注意：S1/S3 ×1 或 ×2 reps（樣本少）。

## T10 🟡 Mock smoke（機制可行性，非 ATM 數字）

- 來源：`SMOKE_RESULT.md`；run-id `smoke-seed42`；2026-10-06 16:58
- mock broker：140/141 commit、0 lost、99.3% vs control 70.2%；27 cold queue（waited mean 39.2 ms）。scenario hash 可重現 `c05b6019aae3f13a…`。
- 用途：只證明 harness 管線可重現；**不可**當 ATM 結果。

## T11 🟡 Derived Atoms 測試（tag v0.1.17）

- 來源：`derived-atoms-candidate-bridge-test.log`、`v017-candidate-bridge.log`、`v017-derived-atom-identity.log`、`v017-derived-atom-occupancy.log`、`v017-derived-atoms-parallel.log`（檔案時間 2026-10-07 06:57–06:58）

| 測試 | 結果（原文） |
|---|---|
| candidate-bridge（9 項） | `all broker candidate-bridge tests passed`；含 `cid.v2 identity is independent of line numbers`、`cold CID conflict scenario reaches native serial admission`、`file overlap scenario (same file, disjoint CIDs -> needs-physical-split)` |
| derived-atom-identity | `ok: derived atom identity (overload merge, ordinals, content version)` |
| derived-atom-occupancy | `ok: derived atom occupancy rules (confirmation, preamble, conflicts, drift)` |
| derived-atoms-parallel | `ok: same-file different-atom tasks run in parallel; overlapping atoms are refused at commit` |

Caveat：單元／整合測試通過（pass/fail），**無延遲或規模數據**；npm 未 publish；bench 尚未有 derived-atoms 臂。
