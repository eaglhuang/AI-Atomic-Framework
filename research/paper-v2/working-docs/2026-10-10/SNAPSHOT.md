# Working-docs snapshot 2026-10-10 — paper 2.0 draft with HIST results

**Status: DRAFT working-docs snapshot. This is NOT a sealed evidence generation and makes NO claims (no win claims).**
狀態：工作稿快照，DRAFT；**不是**封存的證據 generation，不主張任何結論、不主張勝出。論文數字只引用 generation（r1–r6 與 `benchmark-main/`、`benchmark-trials/` 下的 HIST generation），不引用本快照。

## What changed
文一核准（2026-10-10）：把歷史真實 PR benchmark（HIST）的結果寫進論文 2.0 草稿並提交。本快照收錄修改後的論文與三份追蹤文件，以及修改前的備份與 diff。

| 檔案 | 內容 |
|---|---|
| `paper/ATM_PAPER_V2_DRAFT_zh.md` | 論文 2.0 草稿（繁中），新增：摘要一段、§1.5 一項、表 V1 一列、§4.2 結尾換行段、§4.11 元件 (e)、§5.8（HIST 設計，表 E4）、§6.1（表 R7、R7b、R8、R9、R10、R11、R12）、§7.1 HIST 強度上限、§7.2 STALE、§7.3、§8、附錄 C、附錄 H（過程紀錄）、參考文獻 [24]–[29] |
| `paper/checkpoints/ATM_PAPER_V2_DRAFT_zh.pre-hist-2026-10-10.md` | 修改前備份；與 main 上 `generations/r6-2026-10-09/paper/ATM_PAPER_V2_DRAFT_zh.md` 逐位元相同（sha256 `7df9a16b…`） |
| `paper/ATM_PAPER_V2_DRAFT_zh.hist-2026-10-10.diff` | 修改前→後的 unified diff |
| `docs/VERSION_ANCHORS.md`、`docs/EXPERIMENT_CHECKLIST.md`、`docs/METRIC_DEFINITIONS.md` | 各加一節 HIST（版本錨點、完成紀錄、指標口徑） |
| `docs/checkpoints/*.pre-hist-2026-10-10.md` | 三份文件的修改前備份；各與 `generations/r6-2026-10-09/docs/` 同名檔逐位元相同 |
| `docs/support-docs.hist-2026-10-10.diff` | 三份文件修改前→後的 diff |

## Sources of the numbers
全部抄自已合併的 HIST generation 的封存分析輸出，未重算、未新增數字：
- `benchmark-main/2026-10-10-hist-main-v2/`（PR #255，`139cc745`）：`GENERATION.md`、`analysis/TABLES.md`、`analysis/tables.json`、`analysis/BEFORE_AFTER.md`、`DEVIATIONS.md`、`forensics/`。
- `benchmark-main/2026-10-10-hist-main/`（PR #250，`62913443`）：`GENERATION.md`、`STOP_REPORT.md`。
- `benchmark-main/2026-10-10-hist-prereg-v1.1/`（PR #243）、`benchmark-trials/2026-10-09-hist-mining/`（PR #242）、`benchmark-trials/2026-10-10-hist-confirm-v1.1/`（PR #246）、`benchmark-trials/2026-10-09-hist-{smoke,pilot}/`（PR #239）。
- 由逐專案表相加的數字（舊 pin 在 Django＋SymPy 的 13 runs／39 遺失／4 損壞）與由理由分類相加的數字（steward harness 重新定位 4,480＝4,468＋12）在論文中有標明。

## Labels kept
作者自行執行、未獨立重現；CI 另列；描述性、不宣稱勝出（論文明寫 file_lock 在 O3 完成較多、git_three_way 整體完成最多但遺失 36 個效果）；O1-P 配對只評寫入安全終點，語意終點「不可評估」不計 0；試跑不列入結果；Phase 3 450-run 主矩陣仍標**未執行**。

## Verify
`sh verify.sh`（本目錄）或 `sh working-docs/2026-10-10/verify.sh working-docs/2026-10-10`＝`sha256sum -c --strict SHA256SUMS`，嚴格唯讀。`MANIFEST.json` 列出每檔 bytes 與 sha256。本快照建立後不再修改；之後的工作稿另開新的日期目錄。
