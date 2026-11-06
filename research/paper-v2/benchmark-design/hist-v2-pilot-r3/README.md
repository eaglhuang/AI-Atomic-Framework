# HIST-v2 pilot-r3 runner

用 harness v4 與 `hist-v2-dev-replay/2` 重跑已封存 pilot 的同一 29 題、同三臂（steward、file_lock、textual_merge_file）、每題 60 格，共 1,740 格。這是 pilot，不是論文結果。`main` 與 `held-out` 退出碼 2。不改預先登記、harness v2／v3、已封存的 pilot、pilot-r2 或 replay。

v4 相對 v3：三條臂共用單調時鐘的 item T_stop（修訂草案 A8）；時鐘不連續的格子依 A9 作廢、封存在 `raw/invalid/`、以相同種子重跑一次；第二次又作廢即停；作廢超過 1% 即停。每格另外比對臂與計分器的 effective stop（`stop_agreement`），不一致即停。執行前後記錄 `timedatectl` 與 `chronyc tracking`。不呼叫模型。

```bash
HIST_V2_PY=/path/to/site-packages   # jsonschema
PYTHONPATH="$HIST_V2_PY" python3 run_pilot_r3.py run --date 2026-10-30
```
