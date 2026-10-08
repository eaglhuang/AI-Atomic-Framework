# HOT_FILE_LATENCY — 熱檔高壓：provisional + composer vs control

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei），runs 在 19:28–19:30 跑完 |
| Harness | atm-bench 0.3.0-latency ＋本次新增 `--hot-retry none\|loop`、`--atm-writer sync\|stale`（單一 process；mock writer） |
| ATM | `atm_backend=real`：`@ai-atomic-framework/core@0.1.2`（`/workspace/AI-Atomic-Framework/packages/core`，HEAD `ed317820`） |
| Node | v24.21.0（nvm），只在本 box 跑；沒有 CloudAgent／npm publish／Claim Plane |
| 共同設定 | `seed=42`, `trials=50`, `overlap=high`（P(打到 contended 檔)=0.8）, tick 50 ms, hold 20–60 ms, jitter 15 ms, `queue_timeout_ms=15000`；每臂 ×3 reps |
| 情境 | **h1-a8**：hot_ratio **1.0**、8 agents（主要）· **h1-a6**：hot_ratio 1.0、6 agents · **h08-a8**：hot_ratio **0.8**、8 agents（cold 檔用預設 intent atomId → compose） |
| 原始資料 | `runs/hf-<arm>-<tag>-r{1,2,3}`；彙整 `runs/hot-file/summary.{json,md}`、同區重疊 `runs/hot-file/overlap.json`；腳本 `runs/hot-file/{run_matrix.sh,analyze.mjs,overlap.mjs}` |

## 各臂（arm）

| arm | 說明 |
|---|---|
| `control` | 沒有 ATM。先讀 base → hold → 整檔寫回（last-writer-wins） |
| `native` | 真 ATM，**原生**行為：hot 檔的 true-conflict → `reject`（不重試）。writer=`sync`（apply 當下 read-modify-write，等於「理想的 composer/rebase」） |
| `loop` | 真 ATM ＋ **hot_retry loop overlay**：ATM 回 true-conflict 時，harness 等這個檔上**任何一個** ATM 登記的 writer release，然後**再問 ATM**（ATM 決定；等待由 harness 做） |
| `nativestale`／`loopstale` | 同上，但 writer=`stale`：admission 後先讀 base，hold 完把 base＋edit 整檔寫回 ＝ **假設沒有 composer apply**。用來量「ATM 准入本身」能不能防 lost update |
| `mock` | MOCK broker 參考（h1-a8） |

## TL;DR — h1-a8（hot_ratio 1.0、8 agents、每 rep 354 個 intents，×3）

| arm | wall ms（vs ctrl） | decision hist / rep | rejects | commits | **lost / rep（佔 commit）** | 有效成功率（oracle pass / intents） | goodput pass/s | total_ms mean / p95 | overhead_ms mean / p95 | 有等待的 wait p50 / p95 / max（比例） |
|---|---|---|---|---|---|---|---|---|---|---|
| control | 2522（1.00×） | direct_write 354 | 0 | 354 | **253（71.5%）** | 28.5% | 40.0 | 40.7 / 59.0 | 0.18 / 0.27 | — |
| **native** | 2549（**1.01×**） | composer_merge 210 · hot_provisional 60 · **reject 84** | 84（23.7%） | 270 | **0** | 76.3% | 105.9（2.6×） | 36.8 / 65.1 | **4.21 / 6.75** | — |
| **loop** | 2908（**1.15×**） | composer_merge 299.7 · hot_provisional 54.3 | **0** | 354 | **0** | **100%** | **121.8（3.0×）** | 56.8 / 92.7 | 13.4 / 47.9 | **21 / 61 / 124 ms（31.8%）**，rounds mean 1.62 / max 5 |
| nativestale | 2550 | composer_merge 206 · hot_provisional 60 · reject 88 | 88 | 266 | **172.7（64.9%）** | 26.4% | 36.6 | 36.6 / 65.8 | 4.36 / 7.15 | — |
| loopstale | 2882 | composer_merge 297 · hot_provisional 57 | 0 | 354 | **230.7（65.2%）** | 34.8% | 42.8 | 56.2 / 93.7 | 12.8 / 47.4 | 23 / 52 / 84 ms（29.2%） |
| mock（參考） | 2522 | admit 65.7 · hot_provisional 106.7 · composer_merge 109.3 · reject 72.3 | 72.3 | 281.7 | 0 | 79.6% | 111.7 | 33.9 / 58.8 | 1.38 / 10.5 | 34 / 55 / 59 ms（30%） |

**一句話**：熱檔全滿時，真 ATM 原生模式 wall 幾乎不變（1.01×）、每筆多 ~4–5 ms，但 **~24% 的 intents 被 reject**（同區 vs provisional lease → `true-conflict`）；加上 harness 的 hot retry overlay 之後 **0 reject、0 lost、100% 成功**，代價是 wall **+15%**、等待過的 intent 的 wait p95 **61 ms**。**但 0 lost update 完全建立在 composer 真的會 merge 上**：同一組准入決策，如果 writer 不做 composer apply（stale），會丟掉 **65%** 的 commit，跟 control 的 71.5% 差不多。

## 1. Decision 長什麼樣（真 ATM 的 disposition → harness decision）

| harness decision | ATM disposition / verdict / lane / admission state | 什麼時候出現 |
|---|---|---|
| `hot_provisional` | `proposal-required` / `parallel-safe` / `direct-brokered` / **`provisional-write-lease`** | 這個 hot 檔目前沒有其他 writer → 拿到 provisional write lease |
| `composer_merge` | `compose` / `needs-physical-split` / `deterministic-composer` / `composer-routed`（「Same-file proposal compare succeeded; route … through deterministic-composer」） | 同檔已有 writer（**包括同 region**，只要現有的 holder 不是 provisional lease 那一個） |
| `reject` | `true-conflict` / `blocked-active-lease` / `blocked` / `blocked-before-write`（「Second writer must wait; active writer 'TASK-…' should be parked for rearbitration」） | 同 region 撞上 **provisional-write-lease holder** |
| `admit` | `direct` | 只在 h08（cold 檔沒有重疊時） |

h1 情境下 ATM 一次都沒回 `direct`：熱檔一律要 proposal。

### 1.1 同區（same region）並行寫：ATM 准了多少？（`overlap.json`）

以「已 commit 的 intents，其 [admit, release] 區間在同一 path#region 上重疊」計數（每 rep 平均 pair 數）：

| 情境 | control | native | loop | nativestale | mock |
|---|---|---|---|---|---|
| h1-a8 同檔重疊 pairs | 928 | 575 | 763 | 553 | 521 |
| h1-a8 **同區**重疊 pairs | 300 | **156**（全部是 composer_merge＋composer_merge） | 167（同上） | 150 | 107（含 provisional，mock 會等 promotion） |
| h1-a6 同區 | 141 | 52 | 59 | 50 | — |
| h08-a8 同區 | 409 | 297（含 cold 的 admit＋composer） | 183 | 302 | — |

→ **重要發現**：core@0.1.2 的 provisional lease 只擋「跟 lease holder 同區」的第二個 writer；一旦 holder 是 composer-routed，後面同區的 writer **也會被 route 到 composer**（不是 reject 或 queue）。也就是說熱檔同區並行寫是被准許的，正確性完全交給 deterministic composer（`compose.ts` 對 range overlap 會給 `needs-steward`，但 harness 沒有驅動 compose/steward apply）。

## 2. 延遲：ATM 每筆成本 & loop 的等待

### 2.1 各 decision 的延遲（h1-a8，3 reps 合併，ms）

| arm | decision | n/rep | latency p50 / p95 | wait p50 / p95 / max | overhead p50 / p95 | total p50 / p95 |
|---|---|---|---|---|---|---|
| native | composer_merge | 210 | 2.91 / 4.22 | 0 | 5.07 / 7.04 | 48.96 / 65.68 |
| native | hot_provisional | 60 | 2.66 / 4.39 | 0 | 5.11 / 7.10 | 47.00 / 67.85 |
| native | reject | 84 | 0.84 / 1.56 | 0 | 0.88 / 1.67 | 0.88 / 1.67 |
| loop | composer_merge | 299.7 | 3.40 / 42.9 | 0 / 40 / 124 | 5.86 / 45.05 | 55.12 / 92.6 |
| loop | hot_provisional | 54.3 | 3.29 / 56.6 | 0 / 54 / 101 | 5.76 / 58.62 | 53.89 / 101.17 |
| control | direct_write | 354 | 0 / 0 | 0 | 0.17 / 0.27 | 41.22 / 59.03 |

- ATM 自己的計算＋registry I/O：**~2.7–3.4 ms admission + ~2 ms apply/release ≈ 5 ms/intent**，跟 COMPARE_LATENCY.md 的 paced 數字一致；composer 和 provisional 的成本幾乎一樣，reject 最便宜（< 1 ms）。
- loop 的 wait 直方圖（h1-a8 合併 1062 筆）：0 → 724、(0,25] → 203、(25,50] → 101、(50,100] → 32、(100,200] → 2；**0 timeout**。等待上限 ≈ 一次 hold（20–60 ms）＋ 重問的 round（max 5）。
- `schedule_lag_ms` p95：control 16.7、native 35.3、**loop 381.7 ms** —— loop 讓 agent 的 closed loop 落後排程，wall +15% 就是從這來的。

### 2.2 三個情境的 headline

| 情境 | arm | wall ms（vs ctrl） | rejects/rep | lost/rep（率） | 成功率 | goodput/s（vs ctrl） | overhead mean / p95 | wait p95 / max |
|---|---|---|---|---|---|---|---|---|
| h1-a8 | control | 2522 | 0 | 253（71.5%） | 28.5% | 40.0 | 0.18 / 0.27 | — |
| h1-a8 | native | 2549（1.01×） | 84 | 0 | 76.3% | 105.9（2.6×） | 4.21 / 6.75 | — |
| h1-a8 | loop | 2908（1.15×） | 0 | 0 | 100% | 121.8（3.0×） | 13.4 / 47.9 | 61 / 124 |
| h1-a6 | control | 2529 | 0 | 172（63.9%） | 36.1% | 38.4 | 0.19 / 0.29 | — |
| h1-a6 | native | 2549（1.01×） | 59 | 0 | 78.1% | 82.4（2.1×） | 4.38 / 6.93 | — |
| h1-a6 | loop | 2783（1.10×） | 0 | 0 | 100% | 96.7（2.5×） | 11.6 / 43.0 | 59 / 98 |
| h08-a8 | control | 2525 | 0 | 240.7（68.0%） | 32.0% | 44.9 | 0.18 / 0.28 | — |
| h08-a8 | native | 2570（1.02×） | 68 | 0 | 80.8% | 111.3（2.5×） | 4.53 / 7.02 | — |
| h08-a8 | loop | 2768（1.10×） | 0 | 0 | 100% | 127.9（2.8×） | 10.3 / 45.1 | 58 / 96 |

Stale writer（沒有 composer apply）在三個情境的 lost rate：h1-a8 64.9% / 65.2%（native/loop）、h1-a6 55.5% / 54.4%、h08-a8 64.6% / 56.0% —— 跟 control（64–72%）同一個量級。

## 3. 結論（誠實版）

1. **熱檔下 ATM 的「速度成本」很小**：原生模式 wall 1.01–1.02×，每筆 overhead ~4–5 ms；即使加 hot retry overlay 也只有 wall 1.10–1.15×、overhead mean 10–13 ms（p95 ~45–48 ms，主要是等 lease release）。
2. **原生 ATM 會 reject 掉 17–24% 的熱檔 intents**（同區撞 provisional lease）。core@0.1.2 沒有 hot 的 park/rearbitrate 協定可以讓它們之後自己進來（訊息說 "should be parked for rearbitration"，但沒有 queue）—— loop overlay 證明「等一下再問」全部都能進（h1-a8 3 reps 合併：first disposition true-conflict 338 次 → 最後全部是 compose／proposal-required，0 timeout）。
3. **lost update = 0 不是 ATM 准入本身保證的**：同區並行寫被 route 到 composer。只有在 apply 階段做到等同 rebase/merge（本 harness 的 `sync` writer：同一個 event loop 裡同步 read-modify-write）時才是 0；改成 stale writer 就丟 55–65%。要證明真的安全，下一步必須驅動 ATM 的 `composeBrokerProposals`／steward apply 在真實 patch 上跑（這次沒做）。
4. mock 跟 real 的 decision 分佈差很多（mock 對同區用 speculative provisional + promotion 等待；real 用 composer）—— mock 數字不能拿來代表 real ATM。

## 4. 本次改動（可逆、預設行為不變）

| 檔案 | 改動 |
|---|---|
| `src/scenario.mjs` | `DEFAULT_PARAMS` 新增 `hot_retry:'none'`、`atm_writer:'sync'`（以及 Phase 2 的 `mp_registry_sync`、`mp_apply_lock`）。不影響 scenario hash（hash 只算 intents）。 |
| `src/real-broker.mjs` | `hot_retry:'loop'` → 共用 `#admitColdLoop(…, 'hot')`：等 **any** blocker（cold 仍是 all），hot 不改 label（保留 ATM 最後的 mapping），`overlay='hot_retry_loop'`、`reason_code=overlay_wait_on_atm_true-conflict_then_<disposition>`。抽出 `export function buildWriteIntent()`（給 multi-process 共用）。 |
| `src/runner.mjs` | `AtmGateway` 支援 `atm_writer:'stale'`（admission 後讀 base，hold 後寫 base+edit，標 `racy`）；export `AtmGateway`；apply 可走 broker 的 `withApplyLock`（Phase 2 用）。 |
| `src/cli.mjs` | `--hot-retry none\|loop`、`--atm-writer sync\|stale`。 |
| `src/arm-stats.mjs`（新） | 三個 phase 共用的 arm 彙整（decision hist、per-decision 延遲、lost by decision、wait 直方圖）。 |

修改前 src 備份：`/workspace/reports/atm-v2-harness-src-backup-1930/`。

## 5. 重跑

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
runs/hot-file/run_matrix.sh            # ~2 min
node runs/hot-file/analyze.mjs         # → runs/hot-file/summary.{json,md}
node runs/hot-file/overlap.mjs         # → runs/hot-file/overlap.json
# 單臂範例
node src/cli.mjs run-small --mode atm --run-id X --seed 42 --agents 8 --trials 50 --hot-ratio 1 --overlap high \
  --atm-backend real --hot-retry loop --atm-writer sync --queue-timeout-ms 15000 --force
```
