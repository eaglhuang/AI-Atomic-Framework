# PAPER_V2_DRAFT_PACK_INDEX — 一頁索引

更新：2026-10-07（Asia/Taipei）· 根目錄 `/workspace/reports/atm-v2-harness/`

## 1. 主檔章節（`PAPER_V2_DRAFT_PACK.md`）

| § | 標題 | 用途 |
|---|------|------|
| 1 | 文件目的與使用方式 | 標籤 🟢／🟡／🔴 的意義 |
| 2 | 論文定位與貢獻候選（C1–C10） | 鎖定定位 L-P1–L-P4；哪些有證據／僅設計 |
| 3 | 相關工作對照 | ATM vs Claim Plane（鎖定）；ATM v1；Semantic Transactions |
| 4 | 系統機制要點 | 可寫進 System 段的 locked facts；不可寫成已完成清單 |
| 5 | 實驗設置 | 版本 pin、seed、arms、方法共識、threats |
| 6 | 關鍵結果 | R1–R8 論文可用；caveat；勿用 |
| 7 | Derived Atoms／VAI | v0.3 檔案＋v0.4 鎖定方向＋測試；是否夠寫 section |
| 8 | 缺口與風險 | 降調寫法；缺實驗優先序 |
| 9 | 建議章節大綱 | 每節對應表 |
| 10 | 來源索引 | 路徑／日期／一句話 |

關鍵表：`PAPER_V2_KEY_TABLES.md` T1–T11（T1–T3 #180 主表；T4 Oct 6 冷；T5 勿用；T6 熱；T7 成本；T8 mp；T9 scale；T10 smoke；T11 derived atoms）。

## 2. 數據檔位置

| 實驗 | 報告 | 彙整數據 | 原始 run-id |
|------|------|----------|-------------|
| #180 q180（v0.1.17，**主**） | `PAPER_V2_EXPERIMENT_NOTES.md` | `runs/v017-q180/summary.{json,md}` | `runs/v017-q180-{control,native,nqwait}-a{8,16}-r{1..3}`、`runs/v017-q180-1f-*` |
| v0.1.17 冷／熱重測 | `V017_HOT_COLD.md` | `runs/v017/{cold,hot}_summary.{json,md}`、`overlap.json` | `runs/v017-cq-*`、`runs/v017-hf-*`、`v017-cq-probe-noloop-a8` |
| Oct 6 冷檔 | `COLD_QUEUE_LATENCY.md` | `runs/cold-queue/summary.{json,md}`、`compare_{real,mock}_a{8,16}.*` | `runs/cq-*`、`runs/cq1-*` |
| Oct 6 熱檔 | `HOT_FILE_LATENCY.md` | `runs/hot-file/summary.{json,md}`、`overlap.json` | `runs/hf-*` |
| 成本 | `COMPARE_LATENCY.md`、`COMPARE_SMALL.md` | `runs/compare/{paced_rep1,paced_5rep,unpaced_5rep}.*` | `runs/small-*-seed42*`、`runs/unpaced-*` |
| Multi-process | `MULTIPROCESS_SMALL.md` | `runs/multiprocess/summary.{json,md}` | `runs/mp-{A,B}-*` |
| Scale | `SCALE_PRELUDE.md` | `runs/scale/summary.{json,md}` | `runs/sc-S{1..4}-*` |
| Smoke | `SMOKE_RESULT.md` | `runs/smoke-seed42/export/` | `runs/smoke-seed42` |
| Derived Atoms | `VAI_COMMIT_ATLAS_PLAN.md`、`VIRTUAL_ATOM_INDEX_ANALYSIS.md` | `*-candidate-bridge*.log`、`v017-derived-*.log` | — |
| #184 heat（未實作） | `HEAT_WEIGHT_OPTIMIZATION.md` | 無 | 無 |

ATM 樹：v0.1.17 `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`（commit `8dd6a1c6`）；Oct 6 baseline `/workspace/AI-Atomic-Framework`（HEAD `ed317820`）。

## 3. 缺口清單（寫稿前必看）

| # | 缺口 | 狀態 |
|---|------|------|
| G1 | 真 composer apply（0 lost 目前綁 sync writer） | 未做 |
| G2 | 耐久 serial ticket／嚴格 FIFO（`enqueueSerialIntent`＋resume） | 未做 → #180 僅 partial pass |
| G3 | 熱檔 park／rearbitrate（core 寫 park 但直接 reject） | core 未完成；harness overlay 代替 |
| G4 | #184 FileHeat／EMA | 未 merge；只能寫 future work |
| G5 | Derived Atoms 性能／並行度 bench 臂 | 無；只有測試 pass |
| G6 | Derived Atoms Draft v0.4 文件 | 檔案仍為 v0.3；v0.4 只在對話共識 |
| G7 | Claim Plane 對比的原文核對（約 6-pair、未報 worse-than-expected、~25 天時差） | 本 box 無原文；寫前需核對 |
| G8 | 真 LLM／秒級 hold、≥2 vendor 並行 | 未做（`tick` 仍 stub） |
| G9 | 信賴區間、更多 reps（1-file、S2–S4 ×1） | 來源未提供 |
| G10 | 跨機 registry、kill-9 stale-lock、16×1000 mp | 未測 |
| G11 | npm publish | 未 publish（不在本包範圍） |
