# research/paper-v2 — ATM 論文 2.0 可重現證據

> **DRAFT — 不宣稱勝出（no-win claim）。** 本資料夾所有數字皆為草稿階段觀測，尚未通過獨立驗證。r1 是 2026-10-07 外審快照（3 項 P0）；r2（2026-10-08）回應這些 P0；r3 驗證 ATM PR #213（`bea35380`）；r4 驗證 ATM PR #214（`2118bc66`，完成率最佳化）；r5 驗證 ATM PR #216（`37847584`，核心層鎖、孤兒 temp 清理、apply 佇列）並同場重跑四版（作者自行執行、未獨立重現）。**皆未再外審，不可升 final。** r2 的多 process 反例保留；r3／r4 不自動恢復該結論；r4 的跨 PID namespace 反例（F6）在 r5 的 37847584 上未再觀察到遺失；r5 另記一項可用性缺陷（apply 佇列 SQLITE_BUSY 例外，fail-closed）。

## 這是什麼
ATM（AI-Atomic-Framework）論文 2.0（composer＋中立 steward，RQ2 主臂 `--arm steward --atm-backend real --compose-window-ms 100`）的程式碼、原始 run、摘要、表格、論文草稿與審核紀錄。總索引見 [`EVIDENCE_INDEX.md`](./EVIDENCE_INDEX.md)。

| 項目 | 值 |
|------|----|
| ATM pin（唯讀；只以 SHA 參照，不附原始碼樹） | r1／r2：`5692474f7db70ab52a7a71c8af4867609e7e4b43`。r3 驗證 pin：`bea35380d7f381f998c9930fa95f01b999c7f208`（PR #213），對照仍為 `5692474f`。r4 驗證 pin：`2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`（PR #214），對照 `bea35380`、`5692474f`。r5 驗證 pin：`37847584e24afc08ea58cfe380bb5b1220fbe335`（PR #216；queue on／off 兩臂），對照 `2118bc66`、`bea35380`、`5692474f` |
| r1 generation | [`generations/r1-reviewed-2026-10-07/`](./generations/r1-reviewed-2026-10-07/GENERATION.md)（外審快照；**保留且不可變**） |
| r2 generation | [`generations/r2-2026-10-08/`](./generations/r2-2026-10-08/GENERATION.md)（回應 P0；r3 起為歷史，**保留且不可變**） |
| r3 generation | [`generations/r3-2026-10-08/`](./generations/r3-2026-10-08/GENERATION.md)（PR #213 修正驗證；r4 起為歷史，**保留且不可變**） |
| r4 generation | [`generations/r4-2026-10-08/`](./generations/r4-2026-10-08/GENERATION.md)（PR #214 完成率最佳化驗證；r5 起為歷史，**保留且不可變**） |
| r5 generation | [`generations/r5-2026-10-08/`](./generations/r5-2026-10-08/GENERATION.md)（PR #216 驗證＋四版同場重跑；**DRAFT，未再外審**；Phase 3 未做） |
| 工作稿快照 | [`working-docs/2026-10-09/`](./working-docs/2026-10-09/SNAPSHOT.md)（DRAFT 工作稿；**不是 generation**、不主張結論；不可變。內含早期 backup 與中間版，為「所有產出都進 repo」而收錄，不適用 Generation 政策第 5 條） |
| 校驗 | `generations/<gen>/verify.sh`（唯讀；`sha256sum -c SHA256SUMS`） |

## Generation 政策
1. **Generation 不可變（immutable）。** 一旦放入 `generations/<id>/` 並產生 `SHA256SUMS`，該目錄內任何檔案都不得修改、刪除或重新產生指紋。
2. **新的修正一律進入新 generation**（例如 `r2-<描述>-<日期>/`），並在 `EVIDENCE_INDEX.md` 新增一列；舊代保留供比對。不同 generation 的數字不得混用於同一張表。
3. 每代包含：`GENERATION.md`（狀態、已知問題）、`harness/`（程式碼＋腳本）、`docs/`、`paper/`、`tables/`、`summaries/`（原相對路徑）、`raw/*.tgz`（deterministic tar）、`review/`、`SHA256SUMS`、`verify.sh`。
4. `verify.sh` 只讀不寫；封印（seal／refresh 指紋）是另一個明確動作，不得混入 verify。
5. 不含 `node_modules`、secret／`.env`、backup 目錄、ATM pin 原始碼樹。

## 快速驗證
```bash
bash research/paper-v2/generations/r1-reviewed-2026-10-07/verify.sh
# 預期：OK: 274 files verified (read-only)

sh research/paper-v2/generations/r2-2026-10-08/verify.sh
# 預期：OK: 309 files verified (read-only) in .

sh research/paper-v2/generations/r3-2026-10-08/verify.sh
# 預期：OK: 329 files verified (read-only) in .

sh research/paper-v2/generations/r4-2026-10-08/verify.sh
# 預期：OK: 363 files verified (read-only) in .
sh research/paper-v2/generations/r5-2026-10-08/verify.sh
# 預期：OK: 431 files verified (read-only) in .
sh research/paper-v2/working-docs/2026-10-09/verify.sh
# 預期：OK: 79 files verified (read-only) in .
```
**注意：** `harness/reproduce.sh`（r1 版）的 verify 模式會重寫 manifest／checksums，**不可**用來驗證 r1（外審 P0-3）。r2–r5 已把 reproduce 拆成 verify／analyze／rerun／seal；驗證只用各代 `verify.sh`。
