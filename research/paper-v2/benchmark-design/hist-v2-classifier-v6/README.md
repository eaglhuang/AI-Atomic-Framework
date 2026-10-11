# HIST-v2 分類器 v6

這是 ATM paper 2.0 HIST-v2 的**第六版分類器**。它只預先標寫入類別與答案，並提供可執行的契約函數。不跑基準、不宣告勝出，也不是預先登記。

v1、v2、v3、v4、v5 的目錄與 `RULES.md` 都不修改。v5 的規則雜湊是 `08594ccba398a17bc9357b59cdfd19dda24671619857e7bf7119851cbb4c8f22`。

相對 v5，這版拆開評分輸入的兩種資料。接受入口只驗證 `kind=acceptance`，語意入口只驗證 `kind=semantic-evaluation`，兩邊都拒絕多餘欄位，schema 不再用 `oneOf` 讓一種資料從另一種分支通過。另外，安全上正確的全部拒絕不計入吞吐；時間終態與接受紀錄的 ack 或提案身份矛盾時，結果是 `inconsistent`，不是成功。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v6
PYTHONPATH=src python3 -m hist_v2_classify_v6 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v6
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。

評分 schema 的驗證使用 `jsonschema`（見 `requirements.txt`）。
