# HIST-PAIRS 預先登記 v1.1（正式版，凍結）— ATM 論文 2.0 外部真實 PR 工作負載

| 欄位 | 內容 |
|---|---|
| 狀態 | **v1.1 正式版，凍結**。作者於 2026-10-10 00:05（台北時間）決定採用選項 P，並同意「小量確認後開始主跑」 |
| 凍結時間 | 2026-10-10 00:15 前後（台北時間），**在抽主樣本之前**；本文件、腳本與輸入的 SHA-256 見 `SHA256SUMS` |
| 基礎 | v1.0 ＝ `HISTORICAL_BENCH_PREREG_zh.md` v0.1 加作者核准的預設值（6 專案 × 50 對、描述性、附 patch＋授權聲明、box 跑 1–3 天）；挖掘 generation `research/paper-v2/benchmark-trials/2026-10-09-hist-mining/`（PR #242，merge `20effd45`）；提案 `PREREG_v1.1_PROPOSAL_zh.md` |
| 標籤 | 所有結果一律標「作者執行（author-executed），尚未獨立重現」。不宣稱勝出。論文維持 DRAFT |

v1.0 沒有提到的部分一律沿用 v1.0（`HISTORICAL_BENCH_PREREG_zh.md`）。以下只列 v1.1 的變更與凍結值。

## 1. 選取規則變更（只有這一條）
**§3.1(4a) 選項 P（rebase 前 head）。** 若 v1.0 判為 `drift` 的配對中，**恰好一方** X 的 `mb_X` 已包含對方 Y 的合併 commit（Y 在 X 的 base 之前已合併，即 X 已 rebase 到 Y 之上），X 改用 rebase 前的 head h'：
- 候選：X 的每個 `HeadRefForcePushedEvent.beforeCommit`（時間＝事件時間）、X 的每個 PR commit、X 中每個 merge commit 的第一個 parent（時間＝committedDate）。
- 選擇：時間 ≤ `Y.merged_at`、本地物件存在、而且**不包含** Y 合併 commit 的候選中，時間最晚者。
- `mb' = merge-base(h', landing_Y^1)`；X 的 code patch ＝ `diff(mb', h')`。
- v1.0 的 PR 層級規則**全部**套用在 (mb', h')：檔案分類、刪除整檔／模式變更／submodule／非 UTF-8／產生檔、1–12 個原始碼檔、400 行上限。
- `b' = merge-base(mb', mb_Y)`；共同檔必須存在於 b'；兩個 patch 都要無 fuzz `git apply --check` 到 b'；O1／O2／O3 依 v1.0 的 hunk 距離分層。
- 實作：`scripts/build_pairs_v11p.py`（凍結）。挖掘時已 fetch 的物件就是全部輸入；不再呼叫 API。
- 雙方都 rebase 或都沒 rebase 的 drift 配對不適用 P（`p-both-or-none-rebased`）。

**新增標籤**（只描述，不影響分層）：`writer_version = final | pre-rebase`、`o1_kind = identical | divergent`、`rule = v1.0 | v1.1-P | v1.0-O0`。

**選項 P 候選池（凍結前已用凍結腳本計算，未抽樣）：**

| 專案 | P 適用的 drift 配對 | P 候選 | O1 改法不同 | O1 相同修改 | O2 | O3 |
|---|---|---|---|---|---|---|
| Django | 249 | 28 | 6 | 0 | 2 | 20 |
| SymPy | 28 | 23 | 9 | 2 | 3 | 9 |
| xarray | 393 | 160 | 23 | 2 | 15 | 120 |
| pytest | 48 | 30 | 6 | 0 | 3 | 21 |
| Sphinx | 308 | 101 | 20 | 1 | 8 | 72 |
| FastAPI | 138 | 63 | 8 | 0 | 8 | 47 |
| **合計** | 1,164 | 405 | **72** | 5 | 39 | 289 |

與提案估計（O1 改法不同 70）的差異只在 xarray（23 vs 21、O3 120 vs 118）：估計腳本沒有套用「產生檔不計入」和 histogram numstat，正式腳本照 v1.0 全部套用。

## 2. 終點
- **寫入安全終點**（所有配對）：完成 intent／總 intents、失敗 runs／總 runs、遺失效果、blocked intents（依最終理由；**hash drift 另列**）、損壞檔、structure（ast）違規、多餘檔。恆等式「完成＋遺失效果＋blocked＝總 intents」逐 run 驗證。
- **語意終點（STALE 方法）只用於 `writer_version` 兩邊都是 final 的配對**（v1.0 候選與 O0），且需通過 base validity。**任何含 pre-rebase writer 的配對（含所有 O1-P）只算寫入安全終點，語意終點一律標「不可評估（pre-rebase）」，不計 0。** 理由：h' 不是最終合併的程式碼，F2P 測試沒有定義。
- O1 相同修改：兩邊都 `applied` 時同內容出現兩次即錯；oracle 照 `overlap_both_applied` 逐筆鑑識並另列子類。
- 每個 O1 的 run 若兩邊都 applied，必須逐筆鑑識（不論 arm）。

## 3. 抽樣（凍結值）
實作 `scripts/sample_main_v11.py`（凍結）。每個專案獨立：
- pool ＝ v1.0 候選 ∪ v1.1-P 候選，扣除 smoke／pilot 的 33 個 pair_id（`inputs/trial_sample.json`），依 pair_id 排序。
- 主樣本：`numpy.random.Generator(PCG64(20261008))`，依 O1→O2→O3、配額 17/17/16，各層 `rng.permutation`；每 PR 最多 2 對。不足時 `PCG64(20261009)` 依 O1→O2→O3 補到 50 對，補了多少照實記錄。
- O0 對照：每專案 5 對，`PCG64(20261008)` 對「開啟期間重疊、無共同原始碼檔」的配對依 pair_id 排序後排列；兩個 patch 都要能套用到 `b = merge-base(mb_A, mb_B)`；PR 上限與主樣本共用。
- 確認性小量試跑（**試跑，不算正式結果**）在主樣本與 O0 抽完之後才從剩餘的 P 配對抽：`PCG64(20261010)`，先取 2 個 O1 改法不同（pre-rebase），再取 3 個不同專案的配對。這樣確認試跑不可能改變主樣本。

## 4. 執行矩陣（凍結）
| 集合 | 配對 | arm | seed | runs |
|---|---|---|---|---|
| 主矩陣 | 300 | 5（steward、file_lock、occ、git_three_way、bare_composer） | 5（k=0..4） | 7,500 |
| 舊 pin（5692474f，只跑 steward） | 同 300 | 1 | 5 | 1,500 |
| O0 對照 | 30 | 5 | 5 | 750 |
| **合計** | | | | **9,750** |

- seed：`seed = uint32_be(SHA-256("hist-v1|" + pair_id + "|" + k)[0:4])`，與 arm 無關；逐 run 表見 `sample/run_plan.jsonl`。
- harness：`research/paper-v2/benchmark-trials/2026-10-09-hist-pilot/harness`（與 pilot 相同版本；檔案 SHA-256 記於 `PINS.json`），參數 `start_jitter_ms 20, hold_max_ms 30, compose_window_ms 100, occ_max_retries 8, admit queue_timeout 2000 ms / poll 3 ms, worker_timeout 180 s`，多 process（每 PR 一個 OS process）。
- **ATM pin（主）：`20effd45a0c3a09c293caaea6a34face0df1c5f4`**（凍結當下的 main；`packages/` 與 b35a6141 只差 CLI 檔，`packages/core` 完全相同），codeload tarball，ATM 預設值（無 `ATM_STEWARD_*` 覆寫）。舊 pin `5692474f`。
- 並行度：同時 3 個 run（與 pilot 相同），可視 box 負載調整並記入 DEVIATIONS。

## 5. 停止規則與偏離（沿用 v1.0 §6.2）
- **steward（ATM 主方法）出現任何遺失效果或損壞檔＝反例**：凍結該 run 產物，跑完當前專案批次讓分母完整，暫停後續，回報作者並附鑑識。不在同一 generation 中途修 ATM；修好後換新 pin、開新 generation，舊結果保留照實報告。
- 舊 pin（5692474f）的 steward 遺失是已知舊版反例的重現檢查，照實報告，不觸發停止。
- 基準 arm 的遺失照實報告，不觸發停止。
- harness／oracle 錯誤：暫停，記 DEVIATIONS，修正後出新版本、新封存 generation，對已收 run 做 artifact-only 重新評分，新舊並列。
- 每個超過約 12 小時的執行，中途 checkpoint 也要提交到 repo（作者規則：不留 box-only／WIP）。

## 6. 分析（描述性，預先寫定）
每 arm、每專案、每分層、每 `rule`／`writer_version`：完成／總 intents、失敗／總 runs、遺失效果、blocked（依理由，hash drift 另列）、損壞檔、合併後新測試失敗（只限 final-final 且 base-valid 的配對）。比例附 Wilson 95% CI（配對為單位）與配對叢集 bootstrap（10,000 次，種子 20261008）；零事件附 Clopper-Pearson 上界。arm 間只做逐 run 配對的「較高／相同／較低」計數，不做顯著性檢定、不宣稱優越或不劣。CI（GitHub Actions）只驗證紀錄一致性，不重跑實驗，另外寫明。

## 7. 限制（論文必須寫明）
- O1 樣本主要來自 rebase 前的版本：h' 是歷史上真實存在過的 PR 狀態，但不一定是作者最後想要的版本；force-push 事件時間只是近似。
- Django 有 200 個 drift 配對找不到合併前 head（維護者 rebase 後 fast-forward），Django 的 O1 只有 6 個。
- 主樣本裡 Django 的 v1.0 O2 全部已用於試跑，不能再抽。
