# HIST-v2 harness v4

這是 HIST-v2 的 harness 接線。它跑合成 fixture 與單元測試。它不跑 smoke、pilot、主跑或留出集。正式 run 需要另行批准。這裡沒有勝出主張。

方法限制來自凍結目錄 `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`：每份 proposal 30 秒、第一次送出後最多 8 次重試、到達間隔 0／50／100／500／2000 ms、`combined_success`、合法子集以排序後的唯一 proposal id 為鍵。分類器是 v8，規則雜湊 `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541`。ATM 臂使用 core merge `cb25242433882d34b514b79338d1a00def53a875` 的共用 compose inbox。

臂：`atm`、`textual_merge_file`、`steward`、`file_lock`。

v4 相對 v3 的改動（預先登記 v2.1 修訂 A8／A9）見 `GENERATION.md`：三條比較臂共用單調時鐘的 item T_stop，每格做時鐘不連續檢查。

## 跑一個 fixture

在儲存庫根目錄：

```bash
HIST_V2_PY="$PWD/.hist-v2-py"  # any workspace path
python3 -m pip install --target $HIST_V2_PY -r research/paper-v2/benchmark-harness/hist-v2-harness-v4/requirements.txt
export HIST_V2_PYTHONPATH=$HIST_V2_PY
export PYTHONPATH="research/paper-v2/benchmark-harness/hist-v2-harness-v4/src:research/paper-v2/benchmark-design/hist-v2-classifier-v8/src:$HIST_V2_PY"
python3 -m hist_v2_harness_v4 disjoint --arm textual_merge_file --seed 0 --order forward --inter-arrival-ms 0
```

`--arm` 可以是 `atm`、`textual_merge_file`、`steward`、`file_lock`。fixture id 見 `fixtures/catalog.json`：`disjoint`、`same-region-mergeable`、`true-conflict`、`create`、`delete`、`rename`。

這個命令拒絕 `smoke`、`pilot`、`main`、`held-out`。它只寫暫存工作目錄，並印出 manifest 路徑。

單元測試：

```bash
cd research/paper-v2/benchmark-harness/hist-v2-harness-v4
PYTHONPATH="src:../../benchmark-design/hist-v2-classifier-v8/src:$HIST_V2_PY" HIST_V2_PYTHONPATH=$HIST_V2_PY PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

唯讀封印檢查：

```bash
sh research/paper-v2/benchmark-harness/hist-v2-harness-v4/verify.sh research/paper-v2/benchmark-harness/hist-v2-harness-v4
```

## 負控制

五個植入控制在 `negative.py`，名稱與預先登記的對照寫在 `GENERATION.md`。它們不是臂的結果。
