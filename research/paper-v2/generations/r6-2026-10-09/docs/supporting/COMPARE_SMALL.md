# COMPARE_SMALL — ATM (real) vs control（scenario_seed=42）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei） |
| Harness | atm-bench 0.3.0-latency（2026-10-06 17:4x 重跑；latency 見 [COMPARE_LATENCY.md](./COMPARE_LATENCY.md)） |
| Fixture | `atm-bench-fixture-v1-ts`（TypeScript 真碼，非純 comment toy） |
| scenario_seed | **42**（兩 run 共用；scenario sha256 一致） |
| scenario_hash | `80d54e045f6d9c41…` |
| 參數 | `n_agents=6`, `trial_count=30`, `hot_ratio=0.4`, `overlap=med`, `cold_policy=queue`, `composer=on` |
| Node | v24.21.0（real 後端需 ≥22 strip-types） |

## Runs

| | Run A（ATM on） | Run B（control / no ATM） |
|--|-----------------|---------------------------|
| run_id | `small-atm-seed42` | `small-control-seed42` |
| mode | `atm` | `control` |
| atm_backend | **`real`** | **`none`** |
| atm_version | `@ai-atomic-framework/core@0.1.2`（source: `/workspace/AI-Atomic-Framework/packages/core`） | null |
| label | REAL ATM (monorepo broker APIs) | CONTROL (no ATM / no broker) |
| 路徑 | `runs/small-atm-seed42/` | `runs/small-control-seed42/` |

## Real broker evidence（Run A）

- **Import paths（實際呼叫）**
  - `packages/core/src/broker/decision.ts#calculateBrokerDecision`
  - `packages/core/src/broker/admission/evaluate-broker-admission.ts#evaluateBrokerAdmission`
  - `packages/core/src/broker/registry.ts#registerIntent|releaseTask|saveRegistry`
- **Registry 落盤**：`runs/small-atm-seed42/atm/worktree/.atm/runtime/write-broker.registry.json`
- **Capability**：`runs/small-atm-seed42/atm/artifacts/atm_capability.json`
- **事件欄位**：每筆 decision 含 `atm_disposition` / `atm_verdict` / `atm_lane` / `atm_reason` / `atm_write_intent_task`
- **Disposition 直方圖（誠實來自 ATM）**：`compose=62`, `direct=61`, `proposal-required=38`, `true-conflict=7`（重跑後；時序非決定，前次為 62/62/37/7）
  - → harness 映射：`composer_merge` / `admit` / `hot_provisional` / `reject`

## Headline numbers

| metric | ATM (real) | control |
|--------|------------|---------|
| intents (decision events) | 168 | 168 |
| concurrent agents | 6 | 6 |
| committed | 161 | 168 |
| reject / timeout | 7 | 0 |
| oracle pass (marker survives) | **161** | **108** |
| lost updates (oracle fail) | **0** | **60** |
| effective success rate | **95.8%** | **64.3%** |
| racy_overwrite | 0 | **63** |
| decision hist | admit=61, composer_merge=62, hot_provisional=38, reject=7 | direct_write=168 |
| mean wait_ms | 0（本小跑未觸發 ATM native `queue` disposition） | 0 |
| wall_clock_ms | 1557.15 | 1517.18（ATM 慢 1.03×，+39.97 ms） |
| throughput intents/s | 107.89 | 110.73 |
| per-intent total_ms mean / p95 | 44.94 / 65.50 | 40.57 / 58.82（ATM +4.37 / +6.68 ms） |
| per-intent overhead_ms mean（total−hold） | 5.30 | 0.20 |
| goodput oracle-pass/s | **103.39** | 71.18 |

## Contended intents crosstab（同 intent_id 對齊；前次 run 的數字，重跑未重算此表）

- `atm:test_pass / control:test_fail`: **49**
- `atm:test_pass / control:test_pass`: 28
- `atm:reject / control:test_fail`: 4
- `atm:reject / control:test_pass`: 1

解讀：在衝突意圖上，real ATM 保住標記（無 lost update），control 大量 last-writer-wins 覆蓋。

## Gaps（誠實記錄）

1. **冷檔同檔重疊**：ATM 常回 `disposition=compose`（→ `composer_merge`），**不是** `cold_queue`。規格目標冷排隊尚未在此路徑完整落地。
2. **`cold_policy=queue` overlay**：僅在 cold + `true-conflict` 時 wait+retry；最終 decision code 仍以 ATM 回應為準。
3. **未跑完**：CLI shared-surface freeze/ack 全流程、跨進程 tick 准入（仍 stub）。
4. **無 Claim Plane**：未實作 contingent→JIT。

## 重跑指令

```bash
# Node 24（real 必備）
export NVM_DIR=/workspace/.nvm; . "$NVM_DIR/nvm.sh"; nvm use 24
cd /workspace/reports/atm-v2-harness

# Run A — ATM on
node src/cli.mjs run-small --mode atm --seed 42 --run-id small-atm-seed42 \
  --agents 6 --trials 30 --atm-backend real --force

# Run B — control
node src/cli.mjs run-small --mode control --seed 42 --run-id small-control-seed42 \
  --agents 6 --trials 30 --force
```

或：`npm run small:atm` / `npm run small:control`（同樣需 Node ≥22）。
