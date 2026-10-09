# Working-docs snapshot 2026-10-09

**Status: working drafts snapshot. DRAFT. This is NOT a sealed evidence generation and makes NO claims.**
狀態：工作稿快照，DRAFT；**不是**封存的證據 generation（r1–r5 才是），不主張任何結論、不主張勝出。

## Why
文一要求：論文 2.0 的所有產出都要進 repo，不能只留在 box 上（box 上未提交的 WIP 會被另一個 agent 清掉）。
本快照收齊 2026-10-09 08:53（Asia/Taipei）時 box 上「main 尚未逐位元收錄」的論文 2.0 相關檔案。

## How the inventory was made
- 盤點範圍：`/workspace/reports/atm-v2-harness/`（不含 `node_modules/`；`runs/` 全部 3,058 個子目錄都比對過）、
  `/workspace/reports/benchmark-survey/`、`/workspace/reports/{r2-work,r4-work,r4-prep-work,r3-work,r5-work}/`、
  `/workspace/reports/atm-v2-harness-src-backup-{1751,1930}/`、`/workspace/upload/` 的交接用小檔（`fix/`、`tools/`、EVIDENCE_INDEX／README 提案與 patch、sidecar、`sup/` 清單）。
- 比對對象：main（commit tree `ed12396c`，2026-10-09 08:5x 讀取）`research/paper-v2/` 下所有 blob，**以及** r1–r5 與 `archive/` 內各 `.tgz` 的成員內容（git blob sha1 比對）。
- 判定：`on-main-identical`（內容已在 main，含在 tgz 內）／`outdated`（main 有同名檔但內容不同，多為中間版或 superseded 版）／`missing`（main 沒有）。
- 結果（完整表：`INVENTORY.tsv`）：盤點 1,580 檔；1,503 on-main-identical、33 outdated、44 missing。`runs/` 367,530 個 raw 檔除 3 個早期 r2 rescore 輸出外全部已在 main 的 tgz 中；`runs/r5-validation` 1,065 檔全部已在 r5 tgz／summaries 中。
- 本快照收錄所有 outdated 與 missing 檔（相對路徑照 box 鏡像），例外：
  - `atm-v2-harness/refs/arxiv-2607.00041.{pdf,txt}`（論文 v1 的 arXiv 公開副本）依 EVIDENCE_INDEX §6 原決定**不上傳**；sha256：pdf `f7d41247cc590ab70ebc9042a014a9b463ba9d76db31d8faaa7754f5a9006f24`、txt `3e5c5a9412b7113289334b12e39dab20fdf033a709a1a07f0f5ca7c9d56769bf`。

## Layout
| 子目錄 | 來源（box） | 內容 |
|---|---|---|
| `benchmark-survey/` | `/workspace/reports/benchmark-survey/` | 公開 benchmark 調查、歷史 commit/PR benchmark 預先註冊計畫（草稿；尚未執行任何 run） |
| `atm-v2-harness/runs/r5-analysis/superseded-r5-2026-10-08-v1/` | 同名 | r5 v1 分析輸出（已被 r5 generation 內 v2 分析取代，見 r5 DEVIATIONS D2）中與 main 不同的 12 檔 |
| `atm-v2-harness/runs/r2-oracle-rescore/` | 同名 | r2 早期 oracle 重評分輸出 3 檔（r2 generation 攜帶的是後來的 r2-analysis 版本） |
| `r2-work/`、`r4-work/`、`r5-work/` | 同名 | 各回合封存前的中間版（`*.pre-r4fill`、`*.pre-posthoc`、`r5_compare.py.v1`、論文 checkpoint `paper/paper.ckpt-0801.md` 等）與打包清單 |
| `atm-v2-harness-src-backup-{1751,1930}/` | 同名 | 2026-10-06 harness 原始碼早期備份（與 main 不同者） |
| `upload-handoff/` | `/workspace/upload/` | 先前各回合交接用 EVIDENCE_INDEX／README 提案與 patch、build 腳本 `tools/build_paper_v2_r{2..5}.sh`、`fix/harness-r2-src.tgz`（其 49 個成員內容已在 main）、sidecar 與 support 清單 |

## Not included (and why)
- 已在 main 逐位元存在的檔（見 INVENTORY.tsv 的 main_reference 欄）。
- `node_modules/`（依 harness `package.json` 重裝）。
- ATM pin 原始碼 tarball（`/workspace/atm-main-*/`，由 GitHub commit 可重建）。
- 與論文 2.0 無關的 box 檔（ATM 新手摩擦報告、P0 issue 草稿、COBOL 遷移計畫、cloud agent 對話紀錄）。

## Verify
`sh verify.sh`（本目錄）＝`sha256sum -c --strict SHA256SUMS`，嚴格唯讀。`MANIFEST.json` 列出每檔 bytes 與 sha256。
本快照建立後不再修改；之後的工作稿另開新的日期目錄。
