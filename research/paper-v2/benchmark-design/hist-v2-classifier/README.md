# HIST-v2 配對分類／預先標答案工具

這是 ATM paper 2.0 HIST-v2 的**分類器草稿**。它把候選的真實 PR 配對分成寫入類別，並在任何臂開跑之前寫下測試目的與正確答案。

這**不是**凍結預先登記，**不是** evidence generation，也**沒有**跑基準、**沒有**勝出宣告。多程序收件匣、compose-window 掃描與基線臂不在這個工具裡（那些還等設計決定 D5 以後）。

權威設計（本 PR 不修改）：

`research/paper-v2/benchmark-design/2026-10-10-hist-bench-v2/HIST_BENCH_V2_PREREG_zh.md` §2

`research/paper-v2/working-docs/2026-10-10-hist-v2-prereg/` 是位元組相同副本。分類器不讀、不刪那份副本。已封存的 HIST generation 也不在這裡改。

## 規則凍結

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。分類器啟動時核對，不一致就失敗關閉。

```bash
sha256sum -c RULES.sha256
```

改規則必須同時更新 `RULES.md` 與 `RULES.sha256`。在預先登記 v2.0 凍結之前，這個雜湊只凍結**工具行為**，不是正式 prereg。

## 它做什麼

只使用 PR 本身的 Git 特徵：

- hunk 距離沿用 HIST v1.x 的 `dist`（histogram、`-U0`、0-based 半開區間）
- `git merge-file -p`（不用 `--union`／`--ours`／`--theirs`）
- 新建、刪除、改名
- 呼叫端提供的 gold 測試 id 與 STALE `base_validity` 證明

不執行 ATM 或任何基線臂，不讀 `runs/`、`result.json`、`oracle_rows`。本工具也不跑專案測試套件。`base_validity=pass` 必須由呼叫端另行證明後寫進輸入；沒有這份證明時語意旗標是 N，題目仍保留。`base-env-unbuildable` 只把旗標設成 N，不排除。大小不是排除理由。

寫入類別互斥：`A` 不相交、`B` 同區可合併且順序無關、`C` 衝突（只允許單邊或相容子集，不寫混合位元組）、`A'` 相同改法、`B'` 合併乾淨但順序不同、`D` 新建／刪除／改名（寫入安全，fail-closed）。語意旗標 `S`／`N` 與寫入類別正交。

直接套用失敗時，依序嘗試 rebase 前 head（旗標 N），再嘗試三方合併回共同 base。技術排除只有 `head-unavailable`、`checkout-failed`、`binary-or-non-utf8`、`unapplicable-to-common-base`。`shared-pr-with-dev` 只改集合為 `dev-cross-window`，題目仍在 `items.jsonl`。

## 怎麼跑

輸入是本地 git（物件要已經在，這個工具不抓網路）加上 candidates JSONL。每一列 2–4 個 patch：

```json
{"project":"django","target_file":"django/utils/html.py","base":"<sha>","patches":[
  {"pr":1,"mb":"<sha>","head":"<sha>","committer_time":"2024-03-01T00:00:00Z","merged_at":"2024-03-02T00:00:00Z","gold_test_ids":["tests.test_html"],"base_validity":"pass"},
  {"pr":2,"mb":"<sha>","head":"<sha>","committer_time":"2024-03-03T00:00:00Z","merged_at":"2024-03-04T00:00:00Z","gold_test_ids":["tests.test_html"],"base_validity":"pass"}
]}
```

省略 `target_file` 時，會依 v1.x 路徑分類自動展開共同的原始碼檔（測試、文件、vendor、產生檔副檔名略過）。明示 `target_file` 則照該路徑分類。v1.x `writers` 列也可讀；`writer_version=pre-rebase` 會標成 `rebase-before-head`。

金標證明可另放 validity JSONL（`project`、`pr`、`gold_test_ids`、`base_validity`），只填補候選列裡缺的欄位。

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier
PYTHONPATH=src python3 -m hist_v2_classify \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify
```

輸出：

| 檔案 | 內容 |
|---|---|
| `items.jsonl` | 每一題的 id、專案、集合、base、目標檔、patch 來源、commit 時間、送出順序、hunk 範圍、O1/O2/O3、寫入類別、語意旗標、測試目的、正確答案、cluster_id、固定測試 id |
| `excluded.jsonl` | 技術排除與理由碼 |
| `expected/` | 有具體位元組答案時的期望檔案；`expected/manifest.jsonl` 對到 SHA-256 |
| `summary.json` | 依類別、旗標、專案、分層、集合計數；含規則 SHA-256 |

`correct_answer.expected_sha256` 是 A／B／A' 的 git 合併位元組。C 用 `allowed` 列出單邊或相容子集。B' 用 `orders` 分開記。D 是 `write-safety-fail-closed`，不寫混合位元組。

工具只對暫存目錄跑 `git apply`，並用暫存檔跑 `git merge-file`。它不 checkout、不 commit、不改來源儲存庫的 index。

## 測試

合成 git 儲存庫，不需要網路：

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

六專案全量候選要等預先登記凍結、本地物件齊全之後再跑。這個 PR 不跑那次全量，也不解讀任何臂的結果。
