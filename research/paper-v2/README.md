# research/paper-v2 — ATM 論文 2.0 可重現證據

> **DRAFT — 不宣稱勝出（no-win claim）。** 本資料夾所有數字皆為草稿階段觀測，尚未通過獨立驗證。r1 是 2026-10-07 外審快照（3 項 P0）；r2（2026-10-08）回應這些 P0，**尚未再外審，不可升 final**。即使 steward 的 goodput 低於 file-lock／OCC，也照實保留。E4 多 process lost update 在 r2 記為反例。

## 這是什麼
ATM（AI-Atomic-Framework）論文 2.0（composer＋中立 steward，RQ2 主臂 `--arm steward --atm-backend real --compose-window-ms 100`）的程式碼、原始 run、摘要、表格、論文草稿與審核紀錄。總索引見 [`EVIDENCE_INDEX.md`](./EVIDENCE_INDEX.md)。

| 項目 | 值 |
|------|----|
| ATM pin（唯讀；只以 SHA 參照，不附原始碼樹） | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（PR #198 merge；candidate final pin，**pending review**） |
| r1 generation | [`generations/r1-reviewed-2026-10-07/`](./generations/r1-reviewed-2026-10-07/GENERATION.md)（外審快照；已被 r2 取代，**保留且不可變**） |
| r2 generation | [`generations/r2-2026-10-08/`](./generations/r2-2026-10-08/GENERATION.md)（回應 P0；**DRAFT，未再外審**） |
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
```
**注意：** `harness/reproduce.sh`（r1 版）的 verify 模式會重寫 manifest／checksums，**不可**用來驗證 r1（外審 P0-3）。r2 已把 reproduce 拆成 verify／analyze／rerun／seal；驗證 r2 只用 `verify.sh`。
