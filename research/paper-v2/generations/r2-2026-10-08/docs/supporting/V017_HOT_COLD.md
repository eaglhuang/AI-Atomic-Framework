# V017_HOT_COLD — ATM v0.1.17 冷／熱點重測 vs Oct 6 baseline

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07（Asia/Taipei），cold 07:28–07:30、hot 07:30–07:33 CST |
| Harness | atm-bench 0.3.0-latency；腳本 `runs/v017/{run_cold,run_hot}.sh`；run-id 前綴 `v017-`（不覆寫 Oct 6） |
| ATM | **GitHub tag `v0.1.17`**（annotated tag → commit `8dd6a1c6`，訊息「derived atoms…」）；樹 `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`；`ATM_MONOREPO` 強制指向此路徑 |
| 套件版本標籤 | 根／`packages/*` 的 `package.json` 仍寫 **0.1.2**（含 `@ai-atomic-framework/core`）；產品版以 **tag v0.1.17** 為準，勿與 package 數字混淆 |
| Node | v24.21.0（nvm）；只在本 box；**無** CloudAgent／npm publish |
| Baseline | Oct 6：`COLD_QUEUE_LATENCY.md`、`HOT_FILE_LATENCY.md`（當時 monorepo `/workspace/AI-Atomic-Framework`，HEAD `ed317820`，尚無 `decision/serial.ts`） |
| 彙整 | `runs/v017/{cold_summary,hot_summary}.{json,md}`、`overlap.json` |

## TL;DR — 有沒有實質改變？

| 面向 | 結論 |
|------|------|
| **冷點（cold）** | **有實質改變。** v0.1.17 會回原生 `disposition=queue`（`atm_first_disposition` 大量 `queue`；reason `atm_serial_queue`）。Oct 6 同設定只會看到 overlay 對 `true-conflict` 的等待。但本次 matrix 仍帶 `--cold-retry loop`，而 harness 的 loop **只對 `true-conflict` 等待**——對原生 `queue` 會立刻 grant → **wait_ms 全為 0**、wall 明顯變短。**不能**把「wait=0」解讀成「原生 queue ticket 已完整串行」；也不能沿用 Oct 6「全部靠 overlay」的敘事。 |
| **熱點（hot）** | **幾乎沒變。** native 仍 ~24% reject、0 lost（sync writer）；loop overlay 仍 0 reject／0 lost／100% 成功、wall ~1.2×；stale writer 仍 ~65% lost。熱檔仍需 `--hot-retry loop` 才能恢復被 native reject 的 intents。 |
| **#180** | GitHub issue **已 closed（completed，2026-10-06 16:43 UTC）**；樹內有 `packages/core/src/broker/decision/serial.ts` 與 `serial-queue/`。Acceptance「無 overlay 仍能量到原生 queue」**尚未被本次 matrix 完整驗證**（loop 路徑繞過原生 wait）。補充 probe：`--cold-retry once` 可見 wait_ms>0（a8 mean ~21 ms），最終 disposition 多為 `direct`。 |

**一句話給使用者**：熱點行為與 Oct 6 同級；冷點決策已切到原生 `queue`，但 harness loop overlay 還沒跟上，所以本次數字的 wall／wait 不能直接跟 Oct 6 的「overlay 排隊成本」比快慢——要比 disposition 與正確性敘事。

---

## 1. 環境與跑法

共同設定與 Oct 6 相同：

- Cold：`seed=42`, `trials=60`, `hot_ratio=0`, `overlap=cold-same-file`（另 `cold-one-file`×1）, `cold_policy=queue`, `queue_timeout_ms=15000`；agents 8／16；real 用 `--cold-atom-identity region --cold-retry loop`；另 legacy real（不加 region/loop）各 ×1；mock／control ×3。
- Hot：`seed=42`, `trials=50`, `overlap=high`；tags `h1-a8`／`h1-a6`／`h08-a8`；arms control／native／loop／nativestale／loopstale（± mock on h1-a8）×3。

全部 **23 cold + 48 hot** arms 皆完成，無失敗臂。

---

## 2. Cold 比較（Oct 6 → v0.1.17）

### 2.1 Headline（real = region + loop）

| 情境 | 指標 | Oct 6 | v0.1.17 | 變化 |
|------|------|-------|---------|------|
| real a8 | wall ms / vs ctrl | 6155 / **2.03×** | 3394 / **1.12×** | wall 變短（見 caveat） |
| real a8 | waited frac；wait p50/p95/max | 53%；63／268／342 | **0**；— | overlay 未對 `queue` 等待 |
| real a8 | first disposition | true-conflict 707 / direct 616 | **queue 1096 / direct 227** | **改為原生 queue** |
| real a8 | lost / pass per rep | 0 / 441 | 0 / 441 | 相同（sync writer） |
| real a16 | wall / vs ctrl | 9571 / 3.16× | 6639 / 2.19× | 變短 |
| real a16 | waited；first | 70%；true-conflict | **0**；**queue** | 同上 |
| real 1-file a16 | wall / vs ctrl | 39962 / **13.2×** | 7354 / **2.43×** | 變短（同 caveat） |
| mock a8／a16 | wall／wait | ~同 Oct 6 | ~同 Oct 6 | mock 行為穩定 |
| control | lost 率 | 86–93% | 86–93% | 不變 |

### 2.2 Legacy real（unique atomId，無 region/loop）

| | Oct 6 | v0.1.17 |
|--|-------|---------|
| a8 decision | composer_merge 383 + admit 58；wait 全 0 | **admit 441**；wait>0 **65%**（p95 56 ms） |
| a16 decision | composer_merge 798 + admit 81；wait 0 | **admit 879**；wait>0 **88%**（p95 64 ms） |

→ 物理重疊走 composer 的舊路徑在 v0.1.17 上大幅退場；legacy 數字語意已不同，**不宜**再當「compose 成本」對照。

### 2.3 Caveat：為什麼 wall 變短、wait=0，卻仍標 `cold_queue`？

1. ATM 回 `disposition=queue` → harness `mapAtmToHarness` → decision=`cold_queue`／`atm_serial_queue`。
2. `--cold-retry loop` 走 `#admitColdLoop`：**只在 `true-conflict` 時** `waitForBlockers`；遇到 `queue` 直接 `#grantSync` → wait_ms=0。
3. 非 loop 的 `admit()` 另有原生 queue 等待分支；matrix 主臂沒用到。
4. **lost=0** 仍高度依賴 sync mock writer 的 CAS rebase（與 Oct 6 相同前提），不能外推成「原生 queue ticket 已保證串行寫入」。
5. Capability 字串 `native_queue_reachable:false` 仍是 harness 舊註解（寫死 core@0.1.2），**與本次觀測不符**，應視為過期。

補充 probe（不在 matrix 內）：`v017-cq-probe-noloop-a8`（`--cold-retry once`）wall 4514 ms、mean wait 20.6 ms、最終全 `admit`／`direct`（排隊醒來後再 grant）。

---

## 3. Hot 比較（h1-a8 主表）

| arm | 指標 | Oct 6 | v0.1.17 | 變化 |
|-----|------|-------|---------|------|
| control | wall；lost 率 | 2522；71.5% | 2521；71.5% | 同 |
| **native** | wall；reject/rep；lost；成功率 | 2549；84；0；76.3% | 2557；**86.7**；0；**75.5%** | 同級（reject 略增） |
| **loop** | wall；reject；lost；成功率；wait p95 | 2908；0；0；100%；61 | 3037；0；0；100%；**52** | 同級（wall 略高 ~4%） |
| nativestale | lost 率 | 64.9% | 65.0% | 同（無 composer apply → 大量 lost） |
| loopstale | lost 率 | 65.2% | 63.6% | 同級 |
| mock | 成功率 | 79.6% | 79.5% | 同 |

h1-a6／h08-a8 結論相同：native 擋同區 provisional → reject；loop overlay 等 release 再問 ATM → 全過；正確性仍綁在 sync composer 假設上。

同區重疊 pairs（h1-a8，每 rep）：control ~299、native ~150、loop ~176 —— 與 Oct 6（300／156／167）同量級。

---

## 4. 結論表

| 問題 | 答案 |
|------|------|
| 冷／熱行為有沒有**實質**改變？ | **冷：有**（原生 `queue` 出現；wall／wait 數字因 harness 互動而變）。**熱：沒有**（reject／loop／stale 敘事不變）。 |
| 還要不要 `--cold-retry loop`？ | 對 v0.1.17：**loop 不再產生 wait**（因不再走 true-conflict）。要量原生排隊應改跑 **無 loop／once**，或改 harness 讓 loop 也等待 `disposition=queue`。 |
| 還要不要 `--hot-retry loop`？ | **要。** Native 仍 reject ~24% 熱 intents；無 park／rearbitrate 協定。 |
| #180 算落地了嗎？ | Issue closed + 原始碼有 serial lane + 本次看到 `disposition=queue`。但 bench acceptance「關掉 overlay 仍能量 queue／wait」需另開一輪（建議更新 harness 後重跑 cold matrix）。 |

---

## 5. 產物路徑

| 項目 | 路徑 |
|------|------|
| 本報告 | `/workspace/reports/atm-v2-harness/V017_HOT_COLD.md` |
| Cold／Hot 腳本 | `runs/v017/run_{cold,hot}.sh` |
| 彙整 | `runs/v017/cold_summary.{json,md}`、`hot_summary.{json,md}`、`overlap.json` |
| 原始 runs | `runs/v017-cq-*`、`runs/v017-hf-*`（另 probe `v017-cq-probe-noloop-a8`、`v017-smoke-r1`） |
| Oct 6 baseline | `COLD_QUEUE_LATENCY.md`、`HOT_FILE_LATENCY.md` |
