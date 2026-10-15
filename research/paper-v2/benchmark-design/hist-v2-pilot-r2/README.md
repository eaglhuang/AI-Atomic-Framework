# HIST-v2 pilot-r2 runner

用 harness v3 與 `hist-v2-dev-replay/2` 重跑已封存 pilot 的同一 29 題。這是 pilot，不是論文結果。`main` 與 `held-out` 退出碼 2。不改預先登記、harness v2、v1 綁定或已封存的 pilot。

```bash
python3 research/paper-v2/benchmark-design/hist-v2-pilot-r2/run_pilot_r2.py run --date 2026-10-15
```

輸出目錄是 `research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot-r2/`。目錄已有檔案時拒絕覆寫。
