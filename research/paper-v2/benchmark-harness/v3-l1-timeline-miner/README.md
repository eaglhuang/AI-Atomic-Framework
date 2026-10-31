# Prereg v3 L1 時間線 miner（W1）

這是 prereg v3 設計草稿 §6.1–6.2 與 §11 W1 的工程：從 GitHub 公開 API 抓每個 PR 的 commit 清單（author／committer 時間、每個 commit 改的檔案與行數），並推導 L1 重播需要的量。只呼叫 GitHub REST（`gh api`），0 個模型呼叫、0 token。

這裡只有程式與單元測試。它**不是**實驗證據，也沒有跑 L1 pilot 或任何正式探勘；正式探勘（Django 開發集）與保留集（flask／requests）都要另行批准。

## 推導的量（`derived`）

| 欄位 | 定義（草稿 §6.2） |
|---|---|
| `t_start` | PR commit 順序中第一個非 merge commit 的 author date |
| `t_start_min_author` | 所有非 merge commit 最早的 author date（敏感度；歷史被重排時會不同） |
| `t_write[f]` | 第一個碰到 f 的非 merge commit 的 author date；rename 同時算新舊路徑 |
| `t_submit` | PR `created_at`（開 PR = 宣告完成） |
| `t_submit_alt` | 最後一個非 merge commit 的 committer date（敏感度） |
| `s1_files` | 第一個非 merge commit 改到的檔案（D3 主要 claim 範圍） |
| `s2_files` | PR 最終 diff 的檔案（完美預知，只當上限） |
| `s3_dirs` | S1 所在目錄（粗 claim，假警報上限） |
| `line_timeline` | 每個非 merge commit 之後的累積 additions+deletions，`W_det` 的 L1 依據 |

PR 分支裡的 merge commit（例如把 main 併進分支）保留在 commit 清單，但**不抓它的檔案**：GitHub 對 merge commit 只跟第一個 parent 比，檔案清單會混進上游別人的改動。

`flags` 只記錄資料品質（例如 `start-after-submit` 表示歷史被 rebase／force-push 改寫、`committed-after-submit` 表示開 PR 後還有修改），這裡**不排除**任何 PR；排除規則屬於凍結的 prereg。

## 用法

在本目錄：

```bash
# 單元測試（只用 fixture，不連網）
cd tests && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s . -v

# 小量探勘（輸出目錄自訂；拒絕寫在 /tmp 底下）
PYTHONPATH=src python3 -m v3_l1_miner mine --repo django/django \
  --snapshot ../../benchmark-trials/2026-10-09-hist-mining/data/django_pr_snapshot_raw.jsonl \
  --limit 5 --out <工作目錄>/l1-timelines

PYTHONPATH=src python3 -m v3_l1_miner validate --in <工作目錄>/l1-timelines/timelines.jsonl
PYTHONPATH=src python3 -m v3_l1_miner rederive --in <舊.jsonl> --out <新.jsonl>
```

- **可中斷續跑**：`timelines.jsonl` 逐筆 append + fsync；重跑同一個指令會跳過已完成的 PR，並修掉被中斷時寫一半的最後一行（box 還原後直接重跑即可）。`MANIFEST.json` 記筆數、旗標統計、API 呼叫數與 SHA256。
- **rate limit**：每 25 個 PR 查一次 `rate_limit`，剩餘 ≤ 50 就睡到重設；403／429 先等再重試一次；404 記進 `errors.jsonl`。`--max-calls` 可限制單次呼叫數。
- **保留集防護**：`pallets/flask`、`psf/requests` 沒有 `--allow-holdout` 一律拒絕（草稿 §6.1：開發期間不得看保留集）。
- 每個 PR 的 API 呼叫數 = 1（PR）+ commit 清單頁數 + 檔案清單頁數 + 非 merge commit 數。GitHub 的 PR commit 清單上限 250 筆，超過會標 `commits-truncated`。

只用 Python 標準函式庫（3.10+）。`schema/timeline.schema.json` 是紀錄格式；`validate.py` 是不需 jsonschema 的對應檢查。

## 測試 fixture

`tests/fixtures/django-15705/` 是 django/django#15705 的真實 API 回應（只留用到的欄位）：3 個 commit，其中 1 個是把 main 併進分支的 merge commit，用來測「merge commit 不抓檔案」。
