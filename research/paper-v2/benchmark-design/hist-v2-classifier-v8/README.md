# HIST-v2 分類器 v8

這是 ATM paper 2.0 HIST-v2 的**第八版分類器**。它只預先標寫入類別與答案。方法設計已凍結在 `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`。分類與實驗仍有准入閘門。不跑基準、不宣告勝出。

v1 到 v7 的目錄與 `RULES.md` 都不修改。v7 的規則雜湊是 `4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0`。

相對 v7：git 路徑清單使用 `-z`，並把 Git 引號路徑反引號；反斜線等合法檔名可以通過下游路徑檢查，絕對路徑與 `..` 仍拒絕。摘要封印釘到預先登記 v2.0 與本次 argv、日期窗。共享 PR 連通分量沿用 v7 的 `apply_holdout_leakage`，但多個 batch 只在聯集上跑一次。jsonschema 仍釘在 `4.18.0`。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v8
PYTHONPATH=src python3 -m hist_v2_classify_v8 \
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
