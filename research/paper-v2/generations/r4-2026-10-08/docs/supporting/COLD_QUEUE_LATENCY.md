# COLD_QUEUE_LATENCY — 強制同檔 cold 競爭：ATM 有沒有真的排隊？慢多少？

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei），runs 於 17:52–17:57 跑完 |
| Harness | atm-bench 0.3.0-latency ＋本次新增 cold-queue 旗標（`writer=mock`，單一 process） |
| ATM | `atm_backend=real`：`@ai-atomic-framework/core@0.1.2`（`/workspace/AI-Atomic-Framework/packages/core`） |
| Node | v24.21.0（nvm），只在本 box 跑；沒有 CloudAgent / npm publish / Claim Plane |
| 共同設定 | `seed=42`, `trials=60`, `hot_ratio=0`, `overlap=cold-same-file`, `cold_policy=queue`, `queue_timeout_ms=15000`, tick 50 ms, hold 20–60 ms, jitter 15 ms；agents **8** 與 **16**；每臂 ×3 reps（legacy 與 1-file 各 ×1） |
| 原始資料 | `runs/cq-*`, `runs/cq1-*`；彙整 `runs/cold-queue/summary.{json,md}`；分階段表 `runs/cold-queue/compare_{real,mock}_a{8,16}.md` |

## TL;DR

1. **原生 ATM `queue` 在 core@0.1.2 不可達。** `calculateBrokerDecision` 從不輸出 `lane: 'serial'`，所以 `evaluateBrokerAdmission` 的 `disposition = 'queue'` 永遠不會出現（`requestedLane: 'serial'` 也被忽略，見 probe）。先前「cold 變 compose」是因為 harness 給**每個 intent 一個唯一 atomId**，同檔同 region 只剩 Layer-2 物理重疊 → `needs-physical-split` → `deterministic-composer` → `compose`。
2. **讓真 ATM 擋下來的方法**：`--cold-atom-identity region`（atomId/CID 固定為 path#region，也就是「被改的那個 atom」）→ ATM 回 **`blocked-cid-conflict` → `true-conflict`**（真 ATM 的判斷）。再加 `--cold-retry loop`：harness 等 ATM registry 裡的 blocker release，**每一輪都重新問 ATM**，ATM 回 `direct` 才放行（evaluate 和 register 在同一個 critical section 裡完成）。→ **真的拿到 wait_ms > 0**：a8 有 53% 的 intent 排過隊，a16 是 70%。
   - 誠實標註：這裡的「等待」是 **harness overlay** 做的（ATM 只說「衝突／可以了」）；**不是** ATM 原生的 queue ticket。事件裡 `atm_first_disposition=true-conflict`、最後的 `atm_disposition=direct`、`reason_code=overlay_wait_on_atm_true-conflict_then_direct`。
3. **慢多少（vs control，同 seed/scenario）**：

| 情境 | wall ATM / control | wall slowdown | 每筆 total_ms mean（p95） ATM vs ctrl | 排過隊的 wait_ms p50 / p95 / max | throughput int/s | lost updates / rep |
|---|---|---|---|---|---|---|
| **real, 8 agents** | 6155 / 3025 ms | **2.03×** | 95.7（272.8） vs 40.3（59.1）→ **2.37×** | 63 / 268 / 342 ms | 71.7 vs 145.8 | **0** vs 379/441（86%） |
| **real, 16 agents** | 9571 / 3028 ms | **3.16×** | 144.0（367.8） vs 40.2（58.3）→ **3.59×** | 111 / 363 / 652 ms | 91.8 vs 290.3 | **0** vs 815/879（93%） |
| mock cold_queue, 8 | 5436 / 3025 ms | 1.80× | 86.1（253.8）→ 2.14× | 53 / 241 / 300 ms | 81.1 | 0 |
| mock cold_queue, 16 | 7990 / 3028 ms | 2.64× | 121.8（306.9）→ 3.03× | 93 / 297 / 559 ms | 110.0 | 0 |
| real legacy（unique atomId）, 8 | 3166 / 3025 ms | 1.05× | 48.1 → 1.19× | **全部 0**（383 compose） | 139.3 | 0* |
| real legacy, 16 | 5858 / 3028 ms | 1.93× | 80.6 → 2.01× | **全部 0**（798 compose） | 150.0 | 0* |
| **最壞情況：16 agents 全打同一個 cold 檔（`cold-one-file`）**, real | 39962 / 3029 ms | **13.2×** | 700.6 vs 40.2 → 17.4× | 669 / 754 / 791 ms | 22.0 vs 290.2 | 0 vs 819/879 |
| 同上，mock | 35671 / 3029 ms | 11.8× | 628.7 → 15.6× | 601 / 680 / 721 ms | 24.6 | 0 |

\* legacy 的 0 lost 是 harness 的 artefact（mock writer 是同步 read-modify-write，所以 compose 同時寫不會蓋掉彼此），**不代表** composer 在真實 patch 上正確。

**一句話**：讓 cold 同檔真的串行化之後，ATM 在 8 agents 時 wall 慢 **~2×**、16 agents 時慢 **~3.2×**（全部擠在單一檔案時 **~13×**）。換到的是 **0 lost update**；control 則有 86–93% 的寫入被蓋掉。goodput（oracle-pass/s）ATM 71.7 / 91.8 vs control 20.5 / 21.1（**3.5× / 4.3×** 較好）。

## 1. 為什麼 cold 以前變成 compose？（程式碼調查）

`packages/core/src/broker/decision.ts` 的決策順序：shared surface → **CID / atomId 寫入衝突**（`blocked-cid-conflict`）→ proposal overlap（只有 `requiresProposal` 才走）→ **physical overlap**（`evaluatePhysicalOverlap` → `needs-physical-split` / `deterministic-composer`）→ `parallel-safe`。

`evaluate-broker-admission.ts#selectDisposition`：`deterministic-composer → compose`、`lane==='serial' → queue`、其他 blocked 的 → `true-conflict`。用 grep 找遍 `packages/core/src`：**沒有任何 decision 會產生 `lane: 'serial'`**（只出現在 type、`team-lane.ts` 的透傳，以及 `git/admission.ts` 的 mapping）。

Probe（`runs/probe-cold/probe.mjs` → `probe.out`）：兩個同時進來、打同一個 cold 檔同一段行的 intent：

| case | 第二個 intent 的 verdict / lane | disposition |
|---|---|---|
| A 每個 intent 唯一 atomId（舊 harness） | needs-physical-split / deterministic-composer | **compose** |
| B 固定 atomId（path#region） | blocked-cid-conflict / blocked | **true-conflict** |
| C 唯一 atomId ＋ `requestedLane: 'serial'` | needs-physical-split / deterministic-composer | compose（requestedLane 被忽略） |
| D 唯一 atomId ＋ bounded proposal（cold 也送 proposal） | blocked-active-lease / blocked（「Second writer must wait」） | true-conflict |

→ 結論：在 core@0.1.2 用真 ATM，`wait_ms>0` 唯一誠實的做法是**讓 ATM 判 true-conflict，由 harness 等 blocker release 再重問 ATM**。我們選 B（比 D 少改 intent 形狀，語意也是「同一個 atom 有兩個寫者」）。

## 2. 本次改動（harness，可逆、預設行為不變）

| 檔案 | 改動 |
|---|---|
| `src/scenario.mjs` | `overlap: 'cold-same-file'`（每個 trial 所有 intents 都打**同一個** cold 檔，contended 檔從 cold pool 選）與 `'cold-one-file'`（所有 trial 都打 `src/index.ts`）。新 params `cold_atom_identity`（預設 `intent`）、`cold_retry`（預設 `once`）。舊模式的 RNG 序列沒變（`med` seed42 hash 仍是 `80d54e045f6d…`）。 |
| `src/real-broker.mjs` | `cold_atom_identity: 'region'` → cold 檔的 atomId=`atom-<path>-<region>`、CID=hash(path,region,lineStart)。`cold_retry: 'loop'` → `#admitColdLoop`：每一輪 **evaluate＋register 在同一個 critical section**（舊的 once 路徑在 evaluate 與 register 之間有 interleave 空隙）；ATM 回 true-conflict 就等 ATM registry 列出的 blocker release，最多等到 `queue_timeout_ms`。ticket/event 新增欄位 `atm_first_disposition`、`queue_rounds`、`overlay='cold_retry_loop'`。capability 新增 `native_queue_reachable:false` 與說明。 |
| `src/cli.mjs` | `--overlap cold-same-file\|cold-one-file`、`--cold-atom-identity intent\|region`、`--cold-retry once\|loop`、`--queue-timeout-ms N`。 |
| `src/runner.mjs` | 把 `atm_first_disposition`、`queue_rounds`、`timed_out` 寫進 decision event。 |
| `runs/cold-queue/` | `run_matrix.sh`（跑全部）、`analyze.mjs`（wait 直方圖／彙整）、`summary.{json,md}`、`compare_*.md/json`。 |

修改前的 src 備份：`/workspace/reports/atm-v2-harness-src-backup-1751/`。

## 3. 結果細節

### 3.1 wait_ms 直方圖（3 reps 合併的 decision 筆數）

| arm | 0 | (0,25] | (25,50] | (50,100] | (100,200] | (200,400] | (400,800] |
|---|---|---|---|---|---|---|---|
| control a8 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 |
| **real a8** | 616 | 148 | 148 | 157 | 158 | 96 | 0 |
| mock a8 | 570 | 193 | 170 | 161 | 151 | 78 | 0 |
| real legacy a8（×1） | 441 | 0 | 0 | 0 | 0 | 0 | 0 |
| control a16 | 2637 | 0 | 0 | 0 | 0 | 0 | 0 |
| **real a16** | 799 | 235 | 249 | 368 | 549 | 361 | 76 |
| mock a16 | 810 | 276 | 287 | 409 | 537 | 278 | 40 |
| real legacy a16（×1） | 879 | 0 | 0 | 0 | 0 | 0 | 0 |
| real 1-file a16（×1） | 1 | 0 | 1 | 1 | 5 | 12 | 859 |
| mock 1-file a16（×1） | 1 | 0 | 1 | 1 | 7 | 15 | 854 |

0 timeout、0 reject（timeout 設 15 s；最大等待 652 ms／1-file 791 ms）。等待時間上限大約是 (n−1)×hold，因為每個 agent 是 closed loop（一次只有一個 in-flight intent），排隊深度最多 n−1。

### 3.2 wait_ms 佔了多少 overhead（real，3 reps 合併，ms）

| field | real a8 mean / p95 | real a16 mean / p95 | control mean / p95 |
|---|---|---|---|
| wait_ms | 49.5 / 224 | 95.8 / 319 | 0 / 0 |
| broker_ms（ATM 計算＋registry I/O） | 2.53 / 3.78 | 2.72 / 4.06 | 0 |
| apply_ms（寫檔＋releaseTask＋saveRegistry） | 2.38 / 3.76 | 2.34 / 3.64 | 0.1 / 0.2 |
| total_ms | 95.7 / 272.8 | 144.0 / 367.8 | 40.2 / 58–59 |
| schedule_lag_ms | 1546 / 2962 | 2994 / 5892 | ~3 / 15–18 |

→ 排隊後，ATM 自己的 CPU/I/O 成本（~5 ms/intent，跟 COMPARE_LATENCY.md 一樣）只佔 overhead 的 ~5–10%；**慢主要來自串行化等待本身**。另外 `schedule_lag_ms`（agent 落後原定排程多少）a16 p95 達 5.9 s：要看 end-to-end 的影響，要看這個數字跟 wall，不是只看 per-intent total。

### 3.3 real vs mock（相同串行化語意）

real 比 mock 慢一些：wall a8 +13%、a16 +20%、1-file +12%。原因：
- 串行化的 critical path 上每筆多了 ~5 ms 的 ATM broker＋registry I/O。1-file a16 驗算：Σhold 35.2 s ＋ Σ(broker+apply) 4.6 s = 39.8 s ≈ 實測 wall 40.0 s（mock：35.2＋0.5 = 35.7 s ≈ 35.7 s）→ **完全串行，ATM 的成本被直接加在 critical path 上**。
- overlay 不是 FIFO：一個 release 會叫醒所有 waiter，全部回去重問 ATM，只有一個拿到（thundering herd）。`queue_rounds` 平均 a8 2.4、a16 3.3、1-file 14.6（最多 15）。每多一輪，就要多付一次 ATM evaluate 的錢，尾端延遲也比較不公平。mock 是真 FIFO。

### 3.4 legacy（舊 atom identity）對照

同一個 cold-same-file scenario，real legacy **完全沒有等待**（compose 383/441、798/879）。a16 wall 還是慢 1.93×：這是 ATM 的同步 I/O 在單一 event loop 上被 16 個 agent 搶（schedule_lag p95 2.7 s），**不是排隊**。

## 4. 結論（誠實版）

- **有沒有拿到 queue wait？** 有，**但不是 ATM 原生的 queue**。core@0.1.2 根本到不了 `disposition=queue`。我們拿到的是「真 ATM 判 `true-conflict`（CID 寫入衝突）→ harness 等 ATM registry 上的 blocker release → 再問 ATM → `direct`」。每個等待／放行的判斷都來自真 ATM，**排隊機制本身（等誰、何時醒來、順序）是 harness overlay**。mock `cold_queue` 臂（標註 MOCK）給的是乾淨的 FIFO 機制數字，和 real overlay 差 12–20%。
- **慢多少？** 每個 trial 同檔、paced：8 agents wall **2.0×**、per-intent total **2.4×**；16 agents wall **3.2×**、total **3.6×**；全部打同一個檔：**13×**。基本上符合「同檔 cold = 完全串行」的理論：wall ≈ Σhold（每個熱點檔）＋每筆 ~5 ms ATM 成本。
- **換到什麼？** 0 lost update（control 86–93% lost），goodput 是 control 的 3.5–4.3×。
- **還缺什麼**
  1. **ATM 原生 serial lane／queue ticket**：要讓 `calculateBrokerDecision` 對 cold 同 atom（或 policy 標為 cold 的檔）輸出 `lane:'serial'`，並有 queue position／wake-up 協定（現在 `ticket.state='queue'` 只存在於型別）。這是 ATM 這邊的缺口，harness 補不了。
  2. **公平性**：overlay 是 herd re-evaluation，不是 FIFO；要 FIFO 需要 ATM 端的 queue order（或 harness 自己排序，但那就更「不是 ATM」了）。
  3. **Atom identity 的語意**：結果完全取決於 harness 怎麼填 atomId。真實 agent／git-diff admission（`git/admission.ts`）怎麼填，決定了 production 會走 compose 還是 true-conflict，這點還沒驗證。
  4. **單一 process**：16 個 agent 共用一個 event loop；ATM 的同步 registry I/O 會讓其他 agent 也跟著被拖慢（legacy a16 就看得到）。多 process／跨機沒量。
  5. hold 是 20–60 ms 的模擬思考時間；用真 LLM（秒級）時，串行化的絕對等待會等比放大（等待 ≈ (queue depth)×hold），**比例**大致不變。
  6. 沒跑：Claim Plane、CloudAgent、npm publish、unpaced 的 cold 壓測。

## 5. 重跑指令

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
node runs/probe-cold/probe.mjs                 # why compose vs true-conflict
runs/cold-queue/run_matrix.sh                  # all arms (~4 min)
node runs/cold-queue/analyze.mjs               # → runs/cold-queue/summary.{json,md}

# single arms
C="--seed 42 --agents 16 --trials 60 --hot-ratio 0 --overlap cold-same-file --cold-policy queue --queue-timeout-ms 15000 --force"
node src/cli.mjs run-small --mode control --run-id cq-control-a16-r1 $C
node src/cli.mjs run-small --mode atm --run-id cq-real-a16-r1 $C --atm-backend real --cold-atom-identity region --cold-retry loop
node src/cli.mjs run-small --mode atm --run-id cq-mock-a16-r1 $C --atm-backend mock          # MOCK ATM cold_queue
node src/cli.mjs run-small --mode atm --run-id cq-reallegacy-a16-r1 $C --atm-backend real   # legacy → compose, wait 0
node src/cli.mjs compare-latency --atm-run cq-real-a16-r1,cq-real-a16-r2,cq-real-a16-r3 \
  --control-run cq-control-a16-r1,cq-control-a16-r2,cq-control-a16-r3 --report runs/cold-queue/compare_real_a16.md
```
