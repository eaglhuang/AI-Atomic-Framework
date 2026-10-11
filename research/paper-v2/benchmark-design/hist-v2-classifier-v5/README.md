# HIST-v2 分類器 v5

這是 ATM paper 2.0 HIST-v2 的**第五版分類器**。它只預先標寫入類別與答案，並提供可執行的契約函數。不跑基準、不宣告勝出，也不是預先登記。

v1、v2、v3、v4 的目錄與 `RULES.md` 都不修改。v4 的規則雜湊是 `4931ece29c9b39fb5f3b2a5ab32a70920a334a84c8daabfe6d745ca7a2c03544`。

相對 v4，這版把三條還沒對齊的契約定死。重抽樣的最終輸出使用 `point-reported-interval-undefined`：原始點估計有定義時照報，某次重抽分母為 0 則區間未定義，並報告未定義重抽的次數與比例，不事後刪除或改權重。評分輸入由 `validate_score_instance` 對 `schema/score-input.schema.json` 做實例驗證；保留數不得超過參考數，保留的測試 ID 必須是參考通過 ID 的子集。最終吞吐只走 `combined_success`：時間終態、合法集合、位元組等於 R(S) 三者同時成立。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v5
PYTHONPATH=src python3 -m hist_v2_classify_v5 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v5
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。

評分 schema 的驗證使用 `jsonschema`（見 `requirements.txt`）。
