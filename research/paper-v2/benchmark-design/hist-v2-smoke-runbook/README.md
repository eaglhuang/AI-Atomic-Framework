# HIST-v2 smoke runbook

trial-only — 不得作為論文結果

這是冒煙程序與檢查腳本。它不執行 smoke、pilot、主跑或留出集。操作說明在 `RUNBOOK_zh.md`。釘選在 `pins.json`。

```bash
sh research/paper-v2/benchmark-design/hist-v2-smoke-runbook/run_smoke.sh
sh research/paper-v2/benchmark-design/hist-v2-smoke-runbook/verify.sh research/paper-v2/benchmark-design/hist-v2-smoke-runbook
```

預設命令只做開跑前檢查，並印出 `executed: false`。它不建立 `benchmark-trials/`。`--execute` 只在作者批准且分類器 v8 dev 題有歷史 patch 綁定時才會跑 smoke；catalog fixture 不能代替那些題。pilot、main、held-out 直接拒絕。
