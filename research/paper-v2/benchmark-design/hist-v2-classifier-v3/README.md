# HIST-v2 分類器 v3

這是 ATM paper 2.0 HIST-v2 的**第三版分類器**。它只預先標寫入類別與答案，不跑基準、不宣告勝出，也不是預先登記。

v1 在 `research/paper-v2/benchmark-design/hist-v2-classifier/`，規則雜湊 `cae1a7fa9f0a90f46d4abaf9eac0a694b9172918cd190cc244b27e0ecd19e487`。v2 在 `hist-v2-classifier-v2/`，規則雜湊 `51cf1fa839e8ade8f07313c170c532eee084d695701be6a38702750a84161e4c`。v3 不修改那兩棵目錄。

相對 v2，這版改答案鍵與評分器：每一個合法子集都留下參考位元組 R(S)，並用 `maximal` 標出極大子集。v2 會丟掉合法但非極大的子集。安全通過是「接受的集合合法，且檔案等於 R(S)」；進度只問這個集合是不是極大。只接受合法的 {A} 是安全通過、進度不足，不是安全失敗。`score_run` 吃臂的結果（接受集合、觀察到的 SHA-256、有沒有期限內 ack），不在評分時重跑分類。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。這個雜湊只凍結工具行為。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v3
PYTHONPATH=src python3 -m hist_v2_classify_v3 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v3
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。省略 `target_file` 時沿用 v1 的路徑分類。`writer_version=pre-rebase` 會標成 `rebase-before-head`。

輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。每題含 `commit_identities`、`concurrency_outcome`、`labels`。技術排除理由見 `RULES.md`。
