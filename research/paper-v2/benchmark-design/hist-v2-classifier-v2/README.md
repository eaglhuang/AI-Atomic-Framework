# HIST-v2 分類器 v2

這是 ATM paper 2.0 HIST-v2 的**第二版分類器**。它只預先標寫入類別與答案，不跑基準、不宣告勝出，也不是預先登記。

v1 在 `research/paper-v2/benchmark-design/hist-v2-classifier/`，規則雜湊 `cae1a7fa9f0a90f46d4abaf9eac0a694b9172918cd190cc244b27e0ecd19e487`。v2 不修改那棵目錄。

相對 v1，這版改了五件事：全部輸入的極大共同祖先（不用一般多參數 `git merge-base`，多個最佳 base 則技術排除）；`mergeable`／`true-conflict`／`tool-execution-error` 分開，非衝突的非零不得進 C；移植衝突單獨標籤；C 的答案是完整 proposal 的極大合法子集，安全與進度分開；留出集用傳遞的共享 PR 連通分量，再加上相同補丁、cherry-pick、backport。2026-01..09 稱 `later-period-historical-holdout`。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。這個雜湊只凍結工具行為。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v2
PYTHONPATH=src python3 -m hist_v2_classify_v2 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v2
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。省略 `target_file` 時沿用 v1 的路徑分類。`writer_version=pre-rebase` 會標成 `rebase-before-head`。

輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。每題含 `commit_identities`、`concurrency_outcome`、`labels`。技術排除理由見 `RULES.md`。
