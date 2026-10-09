# PAPER_V2_EXPERIMENT_NOTES — ATM 論文 v2.0 實驗對照摘要

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07（Asia/Taipei），#180 matrix 11:33–11:35 CST |
| Harness | atm-bench 0.3.0-latency；**本次改** `--cold-retry native-queue`（見下） |
| ATM | tag **v0.1.17**（commit ~`8dd6a1c`）；`ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17` |
| 套件標籤 | `packages/*/package.json` 仍寫 0.1.2；產品版以 **tag v0.1.17** 為準 |
| Node | v24.21.0（nvm）；**僅本 box**；無 CloudAgent／npm publish／push |
| 主實驗 | `#180` cold queue acceptance：`runs/v017-q180-*`；彙整 `runs/v017-q180/summary.{json,md}` |
| 前序 | Oct 6 `COLD_QUEUE_LATENCY.md`；v0.1.17 重測 `V017_HOT_COLD.md`（loop 主臂 wait=0 的 caveat） |

---

## 0. 本次 harness 變更（只改 atm-bench，未改 ATM monorepo）

| 檔案 | 變更 |
|------|------|
| `src/real-broker.mjs` | 新增 `#admitColdLoop` 對 `cold_retry=native-queue`：**等待 `disposition=queue` 與 `true-conflict`**，直到 re-eval grant 或 timeout；`loop` 維持舊語意（只等 true-conflict）。`once` 路徑補記 `atm_first_disposition`／`queue_position`。capability：`native_queue_reachable:true`，並註明**未**呼叫 `enqueueSerialIntent`。 |
| `src/cli.mjs` / `src/scenario.mjs` | `--cold-retry once\|loop\|native-queue` |
| `src/mp-broker.mjs` | 同步：`native-queue` 等 queue；`once` 也會對 queue 等一輪；`loop` 仍只等 true-conflict |

**旗標語意（冷檔 + `cold_policy=queue`）**

| `cold_retry` | 行為 | 適合 |
|--------------|------|------|
| `once` | 非 loop：ATM 回 `queue` 時等 blockers **一輪**再問；另可對 true-conflict 做一次 overlay | **native** 臂（無 loop overlay） |
| `loop` | 只等 `true-conflict`；對原生 `queue` **立刻 grant** → wait_ms=0（Oct 6／V017 主臂） | 與 Oct 6 overlay 可比；**不能**當 #180 queue cost |
| `native-queue` | loop 等 `queue`∣`true-conflict` 直到 grant／timeout | **#180 acceptance**／論文冷檔排隊成本 |

---

## 1. #180 實驗設計（無 overlay 主臂）

共同：`seed=42`, `trials=60`, `hot_ratio=0`, `cold_policy=queue`, `queue_timeout_ms=15000`, hold 20–60 ms；`cold_atom_identity=region`（real 臂）。

| 臂 | 設定 | 用意 |
|----|------|------|
| **control** | `--mode control` | 無 ATM：正確性／延遲基線 |
| **native** | real + region + `--cold-retry once` | 真 ATM、**無** cold-retry loop overlay；honors 原生 `queue` 等待一輪 |
| **native-queue-wait** | real + region + `--cold-retry native-queue` | 真 ATM + 新路徑：持續等 queue 直到 ATM 放行 |

規模：agents **8／16** × 3 reps；另 `cold-one-file` a16 ×1。run-id 前綴 **`v017-q180-`**（不覆寫 Oct6／`v017-cq-*`）。

---

## 2. 關鍵數字表（論文可用）

### 2.1 正確性 × 延遲（cold-same-file）

| arm | agents | wall ms | vs ctrl | waited frac | wait p50／p95／max (ms) | commits／pass／lost per rep | reject／timeout |
|-----|--------|---------|---------|-------------|-------------------------|------------------------------|-----------------|
| control | 8 | 3025 | 1× | 0 | — | 441／62／**379** | 0／0 |
| **native** | 8 | 4300 | **1.42×** | **0.689** | 25／55／70 | 441／441／**0** | 0／0 |
| **nqwait** | 8 | 6208 | **2.05×** | **0.559** | 62／259／350 | 441／441／**0** | 0／0 |
| control | 16 | 3028 | 1× | 0 | — | 879／64／**815** | 0／0 |
| **native** | 16 | 5873 | **1.94×** | **0.889** | 29／60／85 | 879／879／**0** | 0／0 |
| **nqwait** | 16 | 9416 | **3.11×** | **0.705** | 105／343／637 | 879／879／**0** | 0／0 |

### 2.2 最壞同檔（cold-one-file，a16 ×1）

| arm | wall | vs ctrl | waited | wait p50／p95／max | lost |
|-----|------|---------|--------|-------------------|------|
| control | 3030 | 1× | 0 | — | 818／879 |
| native | 5549 | 1.83× | 0.997 | 22／56／68 | **0** |
| **nqwait** | **40369** | **13.32×** | 0.999 | **679／759／794** | **0** |

→ nqwait 一檔壓力下 wall／wait 與 Oct 6「overlay loop」同量級（Oct 6 real loop 一檔 ~13.2×、wait p50~669），說明**原生 queue 決策 + harness 等待**可再現可量測的串行成本。

### 2.3 Disposition／queue 行為

| arm | atm_first_disposition（或 enqueue 觀測） | 最終 decision | queue_rounds |
|-----|------------------------------------------|---------------|--------------|
| native a8 | enqueue 見 `queue` ×299／441（~68%） | 幾乎全 `admit`（醒來後 `direct`） | once → 至多 1 輪 |
| nqwait a8 | first：`queue` 740／`direct` 583 | `cold_queue` 740 + `admit` 583 | mean 2.37，max 7 |
| nqwait a16 | `queue` 1859／`direct` 778 | `cold_queue` 為主 | mean 3.26，max 15 |
| nqwait 1-file | `queue` 878／879 | 幾乎全 `cold_queue` | mean 14.55，max 15 |

**成功標準核對**：nqwait（與 native）皆有 **wait_ms 不全為 0**；enqueue／first_disp 大量 `disposition=queue`。原生 ATM **會**回 serial queue，且在 harness 等待下 **會**阻塞 caller（至少就 activeIntent file-blocker 模型而言）。

---

## 3. 與 Oct 6／V017 舊數字的可比性

| 來源 | 設定 | wait 語意 | 能否當「冷檔 queue cost」 |
|------|------|-----------|---------------------------|
| Oct 6 `COLD_QUEUE_LATENCY` | region + **`loop`** | overlay 等 **true-conflict**（當時尚無原生 `queue`） | 可當「串行成本」上界，但是 **harness overlay**，不是原生 ticket |
| V017 matrix 主臂 | region + **`loop`** | v0.1.17 已回 `queue`，但 loop **不對 queue 等待** → **wait=0**、wall 虛短 | **不能**；V017 已寫 caveat |
| V017 probe `once` | region + once | 原生 queue 等一輪 → wait mean ~21 ms | 可當「有原生 queue」的弱證據 |
| **本次 q180 native** | region + once | 同 probe；a8 waited 69%，p95 55 ms | 可：無 loop overlay 的原生 wait |
| **本次 q180 nqwait** | region + **native-queue** | 持續等 queue；a8 wall 2.05×、一檔 13.3× | **論文主述「冷檔排隊成本」應優先用此臂** |

**為何舊 V017 wait=0 不能當 queue cost**：`--cold-retry loop` 在 `#admitColdLoop` 只把 `true-conflict` 當等待條件；遇到 `disposition=queue` 會走 `#grantSync` → wait_ms=0。那是 harness bug／語意過期，不是 ATM「排隊免費」。

**與 Oct 6 比 wall**：Oct 6 a8 real loop ~2.03×；本次 nqwait a8 ~2.05× —— 量級一致，但機制不同（true-conflict overlay vs 原生 queue + wait）。不要主張「v0.1.17 變快／變慢」除非同一 `cold_retry` 旗標。

---

## 4. 論文可主張／不可主張

### 可主張（有數據）

1. **v0.1.17 冷檔同 atom（region identity）會回原生 `disposition=queue`（lane=serial）**，不再主要走 Oct 6 的 compose／true-conflict 路徑。
2. **在 harness 對 `queue` 做等待後，wait_ms 可量、不全為 0**；agents↑／同檔壓力↑ → wait 與 wall slowdown↑（8→16→one-file）。
3. **相對 control**：ATM 臂 lost update **0**（sync writer），control **86–93%** lost；goodput（pass/s）ATM 遠高於 control。
4. **冷檔排隊有延遲代價**：nqwait vs control 約 **2×（a8）／3×（a16）／13×（一檔 a16）** wall。

### 不可主張（邊界）

1. **不能**主張「ATM 耐久 serial ticket（`enqueueSerialIntent`／FIFO resume）已在端到端產品路徑驗證」—— harness 只等 **activeIntent file blockers** 再 re-eval，**沒有**寫入／resume `serialQueue.tickets`。ATM metrics 的 `queuePosition` 在此路徑常為空；事件裡的 `position` 多為「目前 file 上 active blockers 數」，**不是**官方 FIFO 序號。
2. **不能**把 FIFO 寫成已嚴格證明：時間序 heuristic 僅弱相關；缺 ticket sequence 觀測。
3. **不能**把「0 lost」外推到真實 LLM／非同步 patch——仍依賴 harness **sync mock writer** 的 CAS rebase（理想 composer apply）。stale writer 在熱檔實驗仍 ~65% lost（見 `HOT_FILE_LATENCY`／`V017_HOT_COLD`）。
4. **不能**用 V017 主臂（loop、wait=0）或 Oct 6 legacy（unique atomId）數字直接當 v0.1.17 原生 queue 延遲。
5. **熱檔 admission／park**：本次未重跑；native 熱檔仍高 reject，需 `--hot-retry loop`；**無** park／rearbitrate 協定（#184 未做）。

---

## 5. #180 acceptance 判定

| 判定 | **partial pass** |
|------|------------------|
| 理由 | Issue #180 已 closed；樹內有 `decision/serial.ts`；本次**關掉 loop overlay** 後，native／native-queue-wait 皆量到 **wait_ms>0** 與大量 `disposition=queue`，滿足「無 overlay 仍能量原生 queue」的 harness 側 acceptance。 |
| 未滿 | 未驅動耐久 queue ticket／明示 FIFO；等待是 harness 對 blocker 的輪詢式等待，非完整 CLI `broker status`／resume 工作流。若產品定義「acceptance = durable ticket FIFO」，則仍缺一截 → 標 **partial**。 |

---

## 6. 仍缺什麼（給論文／工程 backlog）

| 缺口 | 說明 |
|------|------|
| **真 composer apply** | 取代 sync writer；否則「0 lost」綁在理想 rebase |
| **#184 熱度／熱 park** | 使用者指示先不要用 CloudAgent 做；native 熱檔仍靠 overlay |
| **耐久 serial ticket** | harness 呼叫 `enqueueSerialIntent` + eligible resume，才能主張官方 FIFO／position |
| **同區 composer co-write 語意** | 多 writer 進 composer 是設計或 bug，需 ATM 確認 |
| **真 LLM／秒級 hold**、跨機 registry、kill-9 lock 回收 | 見 `REMAINING_TESTS.md` |

---

## 7. 產物路徑

| 項目 | 路徑 |
|------|------|
| 本摘要 | `/workspace/reports/atm-v2-harness/PAPER_V2_EXPERIMENT_NOTES.md` |
| 腳本 | `runs/v017-q180/run_q180.sh`、`analyze_q180.mjs` |
| 彙整 | `runs/v017-q180/summary.{json,md}` |
| 原始 runs | `runs/v017-q180-{control,native,nqwait}-a{8,16}-r{1,2,3}`、`runs/v017-q180-1f-*` |
| Harness 改動 | `src/{real-broker,cli,scenario,mp-broker}.mjs` |
| 前序報告 | `V017_HOT_COLD.md`、`COLD_QUEUE_LATENCY.md`、`HOT_FILE_LATENCY.md` |
