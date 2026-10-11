# HIST-v2 分類器 v7

這是 ATM paper 2.0 HIST-v2 的**第七版分類器**。它只預先標寫入類別與答案，並提供可執行的契約函數。不跑基準、不宣告勝出，也不是預先登記。

v1 到 v6 的目錄與 `RULES.md` 都不修改。v6 的規則雜湊是 `c6889ecb0597646b613397561f428a3de3d8b73f8d48af7faad34fb8e51ef596`。

相對 v6，這版拒絕計數欄位上的非整數。`reference_pass_count` 與 `retained_pass_count` 必須是 Python `int`。`1.0`、`2.0` 與 `bool` 在語意入口就被拒絕，不能經 `semantic_status` 進到 `delivery_rows` 算出 2/1。jsonschema 釘在 `4.18.0`。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v7
PYTHONPATH=src python3 -m hist_v2_classify_v7 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v7
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。

評分 schema 的驗證使用釘死的 `jsonschema==4.18.0`（見 `requirements.txt`）。
