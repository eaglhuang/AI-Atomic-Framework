# Evidence generation r5-2026-10-08

狀態：**DRAFT 證據**。論文仍為 DRAFT，**不主張任何勝出**。r5 是 ATM PR #216（核心層建議鎖、持鎖下孤兒 temp 清理、每目標 apply 佇列）的驗證回合，並在同一時段重跑前三個版本；不是主結果矩陣，論文 **Phase 3（450-run）主矩陣仍未執行**。
所有 r5 數字皆為**作者自行執行、未經獨立重現**。CI 結果另列（§3 末），不是本文實驗。

ATM pin（以 commit SHA 參照並另行安裝，唯讀，不打包原始碼樹）：
- r5 驗證 pin：`37847584e24afc08ea58cfe380bb5b1220fbe335`（PR #216 merge；parents `44a9ee19`、`5e39ee12`；feature `5e39ee1244ed47b3fd3f44f9553fcd690f003894`），以 `ATM_STEWARD_APPLY_QUEUE=on|off` 分成兩臂。
- 對照 pin（同場重跑）：`2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`（r4）、`bea35380d7f381f998c9930fa95f01b999c7f208`（r3）、`5692474f7db70ab52a7a71c8af4867609e7e4b43`（修正前）。

產生時間（Asia/Taipei）：主批次 2026-10-08 17:40:09–18:12:05；事後探索性臂 18:24:59–18:29:30；正式分析 18:31–18:32；論文與封存 2026-10-09。r1–r4 generation 未修改（見 `PRIOR_REFERENCES.md`）。

## 1. 如何驗證／重建

| 指令 | 行為 | 是否寫入 |
|---|---|---|
| `sh verify.sh`（本目錄） | `sha256sum -c --strict` 對照本目錄 `SHA256SUMS`；以多個 part 上傳時，需全部解壓到同一路徑後再驗證（解壓順序不限） | 否，嚴格唯讀 |
| `harness/reproduce.sh analyze <新空目錄>` | 只讀 raw（r1–r5）：contract test、oracle v2 重評分、E4 鑑識、表重建、cell index、logical_id 稽核、r3／r4 比較、**r5 比較（`analysis/r5_compare.py`）**、r1 extractor 比對、raw 唯讀指紋 | 只寫入新目錄 |
| `harness/runs/r5-validation/run_r5.sh` | 重跑 r5（barrier→replay→matrix→regression→e5→faults）；拒絕覆蓋既有 `r5*` run；需四個 ATM pin（`PINS.json`） | 只寫入新 run |
| `PHASES=replay ARMS="nqref nqr0 nqr1" harness/runs/r5-validation/run_r5.sh` | 事後探索性臂（DEVIATIONS D3） | 只寫入新 run |
| `node harness/test/r5_fault_scenarios.mjs --pins "<名>-qon=<tree>,<名>-qoff=<tree>" --out <dir> --reps 10` | 故障情境 F1–F7、F2b、O2（F6／O2 跨 namespace 需 `unshare -Urpf --mount-proc`） | 只寫入 out 與暫存目錄 |

r5 新 raw（deterministic tar＋`gzip -n -9`）：`raw/r5-replay-main.tgz`（old／fix／opt／q／nq 375 runs）、`raw/r5-replay-recompose-ablation.tgz`（qr0／qr1 150＋事後 nqref／nqr0／nqr1 225）、`raw/r5-matrix.tgz`（87）、`raw/r5-regression.tgz`（198）、`raw/r5-e5.tgz`（30）、`raw/r5-stdout.tgz`。barrier、故障情境與 E5 注入結果在 `summaries/runs/r5-validation/`。

## 2. 與 r4 的差異

**Harness**（完整 diff：`harness/R5_CHANGES.patch`，相對封存的 r4 harness）
- `src/steward-writer.mjs`：以 owner 檔寫入次數計鎖取得（37847584 以遞迴 mkdir 建鎖目錄，舊 mkdir 計數恆 0）；每個 batch 記錄實際生效的 `ATM_STEWARD_*`（`atm_env`）。
- `test/barrier_interleave.mjs`：鎖取得改取 max(mkdir, owner 寫入)；摘要新增 `atm_env`。
- `test/r5_fault_scenarios.mjs`（新；r4 檔不變）：pin 名後綴 `-qon／-qoff`；每個子程序記錄 PID namespace、namespace 內 pid、owner 寫入時間、刪除非自建 temp 的時點；新增 F2b、O2、F7 與 F5 的環境變數版本。
- `analysis/r5_compare.py`（新；v2，見 DEVIATIONS D2）；`cell_index.py`、`rescore_oracle_v2.mjs`、`tools/analyze.sh` 新增 r5。
- `runs/r5-validation/{run_r5.sh,pin_record.py}`（新）；`REPRODUCE.md` 新增 r5 節。

**文件**（完整文字 diff：`docs/r5-notes/TEXT_CHANGES_r4_to_r5.diff`）
- 論文依「正文只列結果」重排：§1.5、表 V1、§4.11（重寫：核心層建議鎖、孤兒 temp 清理、apply 佇列與可消融性）、§6 表 R3（版本演進）／R4（E4 重播＋Wilson）／R5（barrier 與故障情境）、§7.1、§7.3、§8；過程與 PR 移至附錄 E（r2–r4 原文，未改）與附錄 F（r5 過程、CI、偏離、鑑識）；參考文獻 [22] PR #216；附錄 C 新增 generation 索引。
- `tables/F2_CORRECTNESS_TABLES.md` 表 A-r5；`docs/METRIC_DEFINITIONS.md` §8；`docs/VERSION_ANCHORS.md`、`docs/EXPERIMENT_CHECKLIST.md`、`harness/REPRODUCE.md` r5 節。

**摘要**
- `summaries/runs/r5-validation/`：PINS.json（四 pin）、ATM core／tests diff、r5.log、barrier、faults、e5 注入、`DEVIATIONS.md`、`forensics/sqlite-busy/`。
- `summaries/runs/r5-analysis/r5-2026-10-08/`：正式分析輸出（含 `r5-compare/R5_TABLES.md`、`r5_summary.json`、`r5_cells.json`）。r4-analysis 不再攜帶，由此重算取代；v1 分析（superseded）不攜帶。

## 3. 主要結果（事實；分列，不合併）

E4 重播（每臂 75 runs、2,610 intents；harness 鎖 off；Wilson 95% 描述性）：

| 臂 | 完成（95% CI） | 失敗 runs | 遺失 | blocked（hash-drift） | 例外未完成 | 損壞 | re-compose 事件／成功 |
|---|---|---|---:|---|---:|---:|---|
| 5692474f | 1,515（58.1%；0.561–0.599） | 6／75 | 6 | 1,089（795） | 0 | 0 | 0／0 |
| bea35380 | 1,534（58.8%；0.569–0.607） | 0／75 | 0 | 1,076（768） | 0 | 0 | 19／2 |
| 2118bc66 | 1,727（66.2%；0.643–0.680） | 0／75 | 0 | 883（0） | 0 | 0 | 103／29 |
| **37847584 queue on** | **1,716（65.8%；0.639–0.675）** | **0／75** | **0** | 894（0） | 3 | 0 | 0／0 |
| **37847584 queue off** | **1,705（65.3%；0.635–0.671）** | **0／75** | **0** | 905（0） | 0 | 0 | 105／35 |
| queue on＋maxRecompose 0（預先登錄） | 1,719（65.9%） | 0／75 | 0 | 891（0） | 2 | 0 | 0／0 |
| queue on＋maxRecompose 1（預先登錄） | 1,746（66.9%） | 0／75 | 0 | 864（0） | 2 | 0 | 0／0 |
| † queue off 參照（探索性） | 1,759（67.4%） | 0／75 | 0 | 851（0） | 0 | 0 | 110／33 |
| † queue off＋maxRecompose 0（探索性） | 1,679（64.3%） | 0／75 | 0 | 931（0） | 0 | 0 | 96／0 |
| † queue off＋maxRecompose 1（探索性） | 1,723（66.0%） | 0／75 | 0 | 887（0） | 0 | 0 | 89／22 |

- 預先登錄的 qr0／qr1 **無區分力**：queue on 時 re-compose 從未觸發（三臂各 0 次）。† 三臂為事後加跑、探索性；同一 queue off 預設在兩時段得 1,705 與 1,759（差 54），臂間差異應對照此幅度。
- 逐 run 配對（描述性）：queue on 對 2118bc66 28 高／15 同／32 低；queue on 對 off 34／13／28。
- barrier：5692474f seam 40／40 遺失；bea35380、2118bc66、37847584 queue off 在 seam／stale-proposal／before-precheck 0 遺失；queue on stale-proposal 0／40、seam 探索性 0／10。
- 故障情境（37847584 qon 與 qoff 各 190 次，2118bc66 對照 50 次）：37847584 全部 0 遺失、0 損壞。跨 PID namespace（真實 `unshare`，兩方向各 10，namespace 分離確認 60／60）：2118bc66 20／20 遺失，37847584 qon／qoff 0／20。偽造 owner＋真持有者存活：2118bc66 10／10 遺失，37847584 0／10。rename 前 SIGKILL：孤兒 temp 2118bc66 留存 10／10；37847584 由下一個持鎖者在取得鎖後刪除（20／20），殘留 0。活著寫入者的 temp：清理入口與第二寫入者 60／60 未刪。
- E4 完整 cells：37847584 0 遺失；5692474f 2 遺失（p8 main、fault_naive 各 1）。單 process 回歸：五臂完成與遺失不變；steward total_ms mean +6.9%（2118bc66→37847584 queue on）。E5 注入：五臂 12／12。
- r5 cells 上 oracle 重評分 0 改判、0 unscored；pin 與 env 檢查皆一致。
- **已知限制（D6，非 §5.7 反例）**：37847584 apply 佇列開啟資料庫時偶發 SQLITE_BUSY 例外，queue on 臂 8 個 intents 未完成（fail-closed：未寫入、0 遺失、0 損壞），presence 檔洩漏；鑑識與重現見 `summaries/runs/r5-validation/forensics/sqlite-busy/`。
- CI（另列）：PR #216 feature head 與 merge 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green；只跑框架測試，CI 記錄無法證明跨 namespace 測試真的互鎖。

## 4. 偏離（全文：`summaries/runs/r5-validation/DEVIATIONS.md`）

| 編號 | 內容 |
|---|---|
| D1 | 代理工作階段於主批次後中斷；無不完整批次，未丟棄或重跑任何 run |
| D2 | 分析腳本 v1 的 env 檢查誤判 git_three_way cells；v2 修正並重跑正式分析，v1 輸出不攜帶、不引用 |
| D3 | 事後探索性臂 nqref／nqr0／nqr1（非預先登錄） |
| D4 | seam／before-precheck barrier 在 37847584 以 `ATM_STEWARD_APPLY_QUEUE=off` 執行；queue on 只做 seam 探索性 5×2 |
| D5 | 故障情境次數：F6 兩方向各 10；F2／F2b／F5 每 variant 5 |
| D6 | 發現 apply 佇列 SQLITE_BUSY 例外（可用性缺陷，fail-closed） |
| D7 | 工具計時與 box 時鐘不同步，時間以 box `date` 為準 |
| D8 | v2 分析 stdout 擷取被截斷（產物完整）；第二次中斷後只做論文、封存、上傳，未重跑實驗 |

## 5. 最佳化項目狀態（論文 §4.11）

| 項目 | 狀態 | r5 證據 | 能否單獨消融 | 尚缺 |
|---|---|---|---|---|
| (a) region 錨定 re-compose | 已實作（CID 錨定未實作） | hash-drift blocked 768→0（bea35380→2118bc66 同場） | 否 | 無區域身分提案 |
| (b) 早期 stale 改走 re-compose | 已實作 | before-precheck barrier 0 遺失 | 否 | — |
| (c) 有界重試＋退避 | 已實作 | queue off：0／1／4 次 1,679／1,723／1,759（探索性）；F5 用盡→blocked | 可（`ATM_STEWARD_RECOMPOSE_POLICY`） | — |
| (d1) repo 範圍鎖 | 已實作 | 不同 TMPDIR 0 遺失 | 部分（`ATM_STEWARD_COMMIT_LOCK_ROOT`；未用） | 網路檔案系統、跨主機 |
| (d2) 核心層建議鎖 | **已實作**（取代 pid／start token 判斷） | F6 跨 namespace 0／40、偽造 owner 0／20 | 否（pin 對照） | 跨主機、網路檔案系統 |
| (d3) 持鎖下孤兒 temp 清理 | **已實作** | 孤兒 20／20 於取鎖後刪除；活 temp 60／60 未刪 | 否 | — |
| (d4) 每目標 apply 佇列 | **已實作** | queue on／off 完成相近；on 時 re-compose 0；SQLITE_BUSY 例外 8 intents | 可（`ATM_STEWARD_APPLY_QUEUE`） | 例外處理、seam 下 10 s 等待 |

**r5 新增限制**
1. apply 佇列 SQLITE_BUSY 例外（D6）。
2. 只以 `unshare` 在同機同檔案系統模擬 PID namespace；未測真實容器 runtime、overlay、網路檔案系統、跨主機。
3. 事後臂與主批次不同時段；時段間變動（54 intents）與臂間差異同量級。
4. Wilson 區間假設 intent 獨立，實際偏窄；未做顯著性或非劣性檢定。
5. (a)(b)(d2)(d3) 無開關，只能以 pin 對照，混有同一版其他變更。
6. 75 次觀察不是正確性證明；Phase 3（450-run 主矩陣）未執行。
