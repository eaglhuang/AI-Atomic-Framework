# A4 — T6／R1 分母核對（64.9%／172.7）

| 欄位 | 內容 |
|------|------|
| 產出 | A4（`EXPERIMENT_CHECKLIST.md`） |
| 日期 | 2026-10-07 20:20 CST（Asia/Taipei） |
| 方法 | **只讀**既有 `export/summary.json` 與彙整 `summary.json`；**未**改 ATM、**未**開 PR、**未**重跑 matrix |
| 原始整數 | `runs/hot-file/t6_r1_raw_counts.json` |
| 結論狀態 | **done**（可重算；64.9% 分母已判定） |

---

## 0. 一句話結論

**64.9% = lost／commits（佔已 commit 的 intents），不是 lost／offered（354）。**  
審閱 R1 的 **48.79%（172.7／354）** 是另一個率（lost／intents≈offered）；**不得**用來改寫表上的 64.9%。

來源欄位名即自證：`lost_update_rate_of_commits`（`src/arm-stats.mjs` L62；`HOT_FILE_LATENCY.md` TL;DR 欄位「lost／rep（**佔 commit**）」）。

---

## 1. 64.9% 的真實分子／分母

### 1.1 對應臂

- 情境：**h1-a8**（`hot_ratio=1.0`，8 agents，`trials=50`，每 rep **354 intents**）
- 臂：**nativestale**（真 ATM native admission + `atm_writer=stale`，無 composer apply）
- 時代：Oct 6，`core@0.1.2`，run-id `hf-nativestale-h1-a8-r{1,2,3}`
- 文獻位置：T6（`PAPER_V2_KEY_TABLES.md`）、`HOT_FILE_LATENCY.md` TL;DR、草稿表 R1 stale／native 診斷列

### 1.2 每 run 原始整數（可重算）

| run_id | intents（offered） | commits | pass（oracle test_pass） | lost（`lost_updates`） | rejects | lost／commits | lost／intents |
|--------|-------------------:|--------:|-------------------------:|-----------------------:|--------:|--------------:|--------------:|
| hf-nativestale-h1-a8-r1 | 354 | 263 | 94 | **169** | 91 | 169/263 = 64.26% | 47.74% |
| hf-nativestale-h1-a8-r2 | 354 | 265 | 95 | **170** | 89 | 170/265 = 64.15% | 48.02% |
| hf-nativestale-h1-a8-r3 | 354 | 270 | 91 | **179** | 84 | 179/270 = 66.30% | 50.56% |
| **3 reps 合計** | **1062** | **798** | **280** | **518** | **264** | **518/798 = 64.9123%** | **518/1062 = 48.7759%** |
| 每 rep 平均（顯示用） | 354 | **266** | 93.3 | **172.7** | 88 | — | — |

校驗：

- `pass + lost = commits`（每 run：94+169=263；95+170=265；91+179=270）→ 此臂上 `lost_updates` ≡ oracle `test_fail`（marker 未留在終態）。
- `commits + rejects = intents`（263+91=354 等）→ reject 未進入 commit 分母。
- 顯示值 **172.7** = mean lost 四捨五入至 1 位：`(169+170+179)/3 = 172.666… → 172.7`（`arm-stats` 的 `r(lost/n, 1)`）。
- 顯示值 **64.9%** = `lost_update_rate_of_commits`：彙整時用 **ratio-of-sums** `lost_sum/commit_sum`，再 `r(…, 4)=0.6491`，表上 ×100 至 1 位 → **64.9%**。

### 1.3 Aggregation：ratio-of-sums vs mean-of-per-run-ratios

| 聚合法 | 算式 | 結果 | 是否＝表上 64.9% |
|--------|------|------|-----------------|
| **ratio-of-sums**（彙整實際採用） | `Σlost / Σcommits = 518/798` | **0.649123 → 64.9%** | **是** |
| mean-of-per-run-ratios | `(169/263 + 170/265 + 179/270)/3` | **0.649019 → 亦約 64.9%** | 數值幾乎相同（本細胞差異 < 0.02 pp） |
| 誤用：mean_lost／intents_per_rep | `172.7 / 354` | **0.48785 → 48.79%** | **否**（審閱 R1 算法） |
| 誤用：ratio-of-sums lost／intents | `518/1062` | **0.48776 → 48.78%** | **否**（另一個率） |

程式證據（`src/arm-stats.mjs`）：

```text
lost_updates_per_rep: r(lost / n, 1),
lost_update_rate_of_commits: commits ? r(lost / commits, 4) : 0,
```

此處 `lost`／`commits` 為 **跨 reps 加總**後再相除 → **ratio-of-sums**。

### 1.4 與 METRIC_DEFINITIONS 的對照

| 舊 harness 欄位 | 約對應 A2 指標 | 本細胞數值 |
|-----------------|----------------|------------|
| intents | offered（每 rep） | 354 |
| commits | committed（acknowledged write；舊語意） | 266/rep mean |
| lost_updates | **近似** lost-among-committed（舊 marker oracle） | 172.7/rep mean |
| `lost_update_rate_of_commits` | lost among committed **率**（舊 oracle） | **64.9%** |
| success_rate_of_intents = pass/intents | **不是** correct completion；舊「有效成功率」 | 26.4% |
| rejects | 准入拒絕（未 commit） | 88/rep mean |

Caveat（不變）：舊 marker oracle ≠ A2 的獨立 byte／效果 oracle；stale 臂是故障注入，省略合成協定。

---

## 2. 審閱 48.79%（172.7／354）對應什麼

| 項 | 內容 |
|----|------|
| 出處 | `ATM_PAPER_V2_FEASIBILITY_REVIEW.md` §三：「R1 的 172.7 若以每 rep 354 intents 作分母，約為 48.79%，不是 64.9%」 |
| 算式 | `172.7 ÷ 354 ≈ 0.48785`（用**已四捨五入的 mean lost** ÷ **intents_per_rep**） |
| 精確整數版 | `518 ÷ 1062 ≈ 0.48776`（48.78%） |
| 語意 | **lost／offered（intents）**，含「從未 commit」的 reject 在分母裡、但不在分子裡 → 比率被拉低 |
| 與表關係 | **不同指標**；解釋「為何有人算出 48.79%」；**禁止**把 T6／R1 的 64.9% 改成 48.79% |

論文／表格應同時可報（若需要）：

1. **lost among committed** = 64.9%（主欄位，與原表一致）  
2. **lost／offered** ≈ 48.8%（輔報；並註 reject 88/rep 未進入 committed）

---

## 3. T6 相關臂一覽（h1-a8；每 rep 平均＋可重算合計）

### 3.1 Oct 6（`runs/hot-file/`；core@0.1.2）

| arm | intents | commits | pass | lost | rejects | lost／commits（ratio-of-sums） | lost／intents | 表上常用％ |
|-----|--------:|--------:|-----:|-----:|--------:|-------------------------------:|--------------:|-----------|
| control | 354 | 354 | 101 | 253 | 0 | 759/1062 = **71.47%** | 71.47% | 71.5% |
| native | 354 | 270 | 270 | 0 | 84 | 0 | 0 | 0 lost；成功率 76.3%=pass/intents |
| loop | 354 | 354 | 354 | 0 | 0 | 0 | 0 | 0；100% |
| **nativestale** | 354 | **266** | 93.3 | **172.7** | 88 | **518/798 = 64.91%** | 48.78% | **64.9%** |
| loopstale | 354 | 354 | 123.3 | 230.7 | 0 | 692/1062 = **65.16%** | 65.16% | 65.2% |
| mock | 354 | 281.7 | 281.7 | 0 | 72.3 | 0 | 0 | 成功率 79.6% |

說明：control／loopstale 的 commits＝intents，故 lost／commits ≡ lost／intents。  
**nativestale** 因 reject≈88，兩種分母才分叉（64.9% vs 48.8%）。

### 3.2 v0.1.17（`runs/v017/`；tag `8dd6a1c6`；T6 右側欄）

| arm | commits mean | lost mean | rejects mean | lost／commits（ratio-of-sums） | 表上％ |
|-----|-------------:|----------:|-------------:|-------------------------------:|--------|
| control | 354 | 253 | 0 | 71.47% | 71.5% |
| native | 267.3 | 0 | 86.7 | 0 | 0；成功率 75.5% |
| loop | 354 | 0 | 0 | 0 | 100% |
| **nativestale** | **261.7** | **170** | 92.3 | **510/785 = 64.97%** | **65.0%** |
| loopstale | 354 | 225 | 0 | 675/1062 = **63.56%** | 63.6% |
| mock | 281.3 | 0 | 72.7 | 0 | 79.5% |

v017 nativestale 每 run：

| run_id | commits | pass | lost | rejects | lost／commits |
|--------|--------:|-----:|-----:|--------:|--------------:|
| v017-hf-nativestale-h1-a8-r1 | 264 | 94 | 170 | 90 | 64.39% |
| v017-hf-nativestale-h1-a8-r2 | 265 | 91 | 174 | 89 | 65.66% |
| v017-hf-nativestale-h1-a8-r3 | 256 | 90 | 166 | 98 | 64.84% |

表上「65.0%」= `r(510/785, 4)=0.6497` → 64.97% → 顯示 **65.0%**；對應 lost／intents = 510/1062 ≈ **48.02%**（同樣不可拿來改 65.0%）。

### 3.3 其他情境 stale（Oct 6；佐證「55–65%」量級）

| 情境 | arm | intents/rep | commits mean | lost mean | lost／commits | 文獻％ |
|------|-----|------------:|-------------:|----------:|--------------:|--------|
| h1-a6 | nativestale | 269 | 209.7 | 116.3 | 55.48% | 55.5% |
| h1-a6 | loopstale | 269 | 269 | （見 raw JSON） | ≈54.4% | 54.4% |
| h08-a8 | nativestale | 354 | 292 | 188.7 | 64.61% | 64.6% |
| h08-a8 | loopstale | 354 | 354 | （見 raw JSON） | ≈56.0% | 56.0% |

完整 per-run 整數見 `t6_r1_raw_counts.json`。

---

## 4. 草稿 R1 列如何讀（不改原數字）

草稿表 R1 stale／native 診斷列既有寫法「172.7/rep（64.9%，分母＝committed）」**正確**。本 A4 補上：

- aggregation = **ratio-of-sums**（與 mean-of-ratios 在本細胞幾乎相等，可並註）
- 審閱 48.79% = lost／354 offered，**併陳即可，不替換**
- raw 路徑：`runs/hot-file/t6_r1_raw_counts.json`

---

## 5. 路徑與可重現（只讀）

| 項目 | 路徑 |
|------|------|
| 本審計 | `T6_R1_DENOMINATOR_AUDIT.md` |
| 原始整數 JSON | `runs/hot-file/t6_r1_raw_counts.json` |
| Oct 6 彙整 | `runs/hot-file/summary.json` → `h1-a8.nativestale` |
| Oct 6 每 run | `runs/hf-nativestale-h1-a8-r{1,2,3}/export/summary.json`（欄位 `modes.atm.lost_updates`、`outcome_hist.commit`、`intents`） |
| v017 彙整 | `runs/v017/hot_summary.json` |
| v017 每 run | `runs/v017-hf-nativestale-h1-a8-r{1,2,3}/export/summary.json` |
| 率定義程式 | `src/arm-stats.mjs`（`lost_update_rate_of_commits`） |
| 敘事來源 | `HOT_FILE_LATENCY.md` TL;DR；`PAPER_V2_KEY_TABLES.md` T6；審閱 R1 段落 |

重算指令（不跑實驗，只讀檔）：

```bash
python3 -c "print(518/798, 172.7/354, (169/263+170/265+179/270)/3)"
# 0.6491228…  0.487853…  0.649019…
```

---

## 6. 決策（給稿／表）

| 動作 | 決定 |
|------|------|
| 是否把 64.9% 改成 48.79% | **否** |
| 64.9% 分母 | **commits（lost among committed）** |
| 48.79% | 標為 lost／offered 的**另一讀法**／審閱試算 |
| 原表 T6 數字 | **保留**；加勘誤註指向本檔 |
| 是否缺原始整數 | **不缺**（已自 `export/summary.json` 抽出） |
