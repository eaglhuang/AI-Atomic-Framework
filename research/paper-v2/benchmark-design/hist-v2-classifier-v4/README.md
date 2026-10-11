# HIST-v2 分類器 v4

這是 ATM paper 2.0 HIST-v2 的**第四版分類器**。它只預先標寫入類別與答案，並提供可執行的契約函數。不跑基準、不宣告勝出，也不是預先登記。

v1、v2、v3 的目錄與 `RULES.md` 都不修改。v3 的規則雜湊是 `72437b355071436d786d22f3d5394b31e68ee24f9d7289d70697b7d2e5ff1982`。

相對 v3，這版把合法子集的鍵定成排序後的 proposal id 集合。產生器與 `score_run` 都用這把鍵，所以提交時間先後寫成 `[3, 1]` 的集合，與 `[1, 3]` 是同一筆。另外鎖住四條契約：鎖內 base 變了必須丟棄鎖外候選並計一次重試；逾時對帳的終態；跨專案等權遇到零分母時不事後刪除或改權重；R(S) 沒有通過的測試是不可評。

操作性規則在 `RULES.md`。`RULES.sha256` 是該檔的 SHA-256。不一致就拒絕啟動。

```bash
sha256sum -c RULES.sha256
```

## 怎麼跑

```bash
cd research/paper-v2/benchmark-design/hist-v2-classifier-v4
PYTHONPATH=src python3 -m hist_v2_classify_v4 \
  --repo /path/to/project.git \
  --candidates candidates.jsonl \
  --validity validity.jsonl \
  --out-dir /tmp/hist-v2-classify-v4
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

輸入是本地 git 物件加上 2–4 個 patch 的 JSONL。輸出 `items.jsonl`、`excluded.jsonl`、`expected/`、`summary.json`。
