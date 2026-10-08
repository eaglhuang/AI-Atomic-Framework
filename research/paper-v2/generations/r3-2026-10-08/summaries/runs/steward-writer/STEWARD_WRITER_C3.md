# C3 — Independent oracle（effect_id + final file bytes）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 21:22 Asia/Taipei（CST, UTC+8） |
| 實作 | `src/oracle.mjs`（`ORACLE_VERSION=c3-effect-bytes-v1`） |
| 預登記 | `scenarios/expected_effects.json`（scenario build 時寫入） |
| 產物 | `artifacts/oracle_summary.json`、`artifacts/oracle_results.jsonl`；events `event:'oracle'` |
| ATM pin | `5692474f…`（未改 ATM 原始碼） |

## 原則（對齊 `METRIC_DEFINITIONS.md` §1.5）

- **正確性裁判** = 預登記 `effect_id`／`exact_line`／`token` 對 **最終檔案 bytes** 的出現次數與（可選）region 位置。
- **禁止**把 ATM `steward_verdict` 當 correct 判定（僅 `steward_verdict_diag` 診斷欄）。
- **禁止**只用模糊 marker substring 當唯一裁判；本 oracle 以 **exact_line 優先**，token 為後備，並檢查 **occurrence_count ≤ 1**。
- `eligible:true` 在 scenario 生成時預登記，**不**由受測方法 accept/reject 回填。

## Verdict schema（`oracle_verdict`）

| verdict | 含義 | `outcome`（相容） |
|---------|------|-------------------|
| `correct` | commit 且恰好 1 次；在 region 內（或 region 標籤缺失時仍以 presence 計） | `test_pass` |
| `lost` | commit 但 0 次 | `test_fail` |
| `duplicate` | commit 且 >1 次 | `test_fail` |
| `misplaced` | commit、1 次、但在 region 外 | `test_fail` |
| `blocked_absent` | blocked 且 0 次（fail-closed） | `test_pass` |
| `blocked_leak` | blocked 但仍寫入 | `test_fail` |
| `absent_uncommitted` | reject/timeout/error 且 0 次 | `test_pass` |
| `unexpected_write` | 非 commit 終態卻有寫入 | `test_fail` |
| `unresolved` | 無 terminal decision | `test_fail` |

Oracle 事件另含：`effect_id`、`logical_id`、`output_digest`、`occurrence_count`、`matched_via`、`region_loc`、`eligible`、`terminal_outcome`。

## expected_effects 列

`{ logical_id, intent_id, path, region, effect_id, token, exact_line, agent_id, eligible:true, … }`

`exact_line` = `// atm-edit <intent_id> by <agent_id>`（與 harness writer 插入語意一致）。

## Smoke（`steward-c3-smoke`）

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
node src/cli.mjs start --mode atm --atm-backend real --atm-writer steward \
  --run-id steward-c3-smoke --seed 7 --agents 4 --trials 6 --hot-ratio 1 --overlap high \
  --compose-window-ms 100 --hold-ms-min 10 --hold-ms-max 35 --tick-interval-ms 20 --force
```

| 指標 | 值 |
|------|-----|
| exit | 0 |
| expected_effects | 19（皆 eligible） |
| oracle correct / lost / blocked_absent / duplicate | **19 / 0 / 0 / 0** |
| region_loc inside | 19 |
| multi compose batches（size≥2） | 2；兩批 intents marker／effect 皆在 |

## Gaps → C4

- 診斷臂（raw overwrite、admission-only／stale、ideal sync）包裝與對照表。
- `logical_id` 與 intent 完全脫鉤的 workload 登記（目前 stub=`intent_id`）。
- AST／語意級 effect（非行插入）尚非本 harness 範圍。
