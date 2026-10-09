# C2 — Compose window／batch closure 語意＋事件欄位

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 21:20 Asia/Taipei（CST, UTC+8） |
| 依賴 | C1（`--atm-writer steward`） |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| 規格 | `METRIC_DEFINITIONS.md` §0 Batch closure、§3 事件欄位 |
| 實作 | `src/steward-writer.mjs`（`ComposeWindowManager`／`resolveExpectedCount`） |

## 凍結語意

### 1. Close conditions（先到先關）

| `close_reason` | 條件 |
|----------------|------|
| `immediate` | `compose_window_ms === 0` **或** `expectedCount === 1`（單提案／非 composer） |
| `count` | `entries.length >= expectedCount`（有限 peer 數，通常來自 ticket.`cowriters`） |
| `timeout` | `compose_window_ms` 逾時（finite 且 >0），且尚未達 count |

`--compose-window-ms 0` 明確支援：每提案立即單件 batch（仍有 `batch_id`）。

### 2. Late joiner（寫死）

**關閉後**抵達同檔的 proposal → 開啟 **新** batch（`ComposeWindowManager` 在 close 時 `windows.delete(path)`）。  
**永不**加入已關閉的 batch。不 blocked、不 re-queue（C2 選擇「新 batch」；re-propose 迴圈屬 P1-3／C2-out）。

### 3. Scheduler

**Harness** `ComposeWindowManager` 擁有 close（不是 ATM core／broker）。

### 4. expectedCount（real ATM gap）

| 來源 | `expected_source` | 行為 |
|------|-------------------|------|
| `compose_window_ms===0` | `window_zero` | expectedCount=1 → immediate |
| ticket.`cowriters`.length>0 | `ticket_cowriters` | expectedCount = len+1 → 可 `count` 關 |
| `composer_merge`／composer 且無 cowriters | `composer_timeout_only` | expectedCount=∞ → **timeout 為主** |
| 其他 | `single` | expectedCount=1 → immediate |

**Gap（已記錄）**：`RealAtmBroker` **從不填** `cowriters`。Real `composer_merge` 因此以 timeout 收窗；mock broker 有 cowriters 時可走 `count`。

### 5. 事件

- **專用** `event:'compose_batch'` → `atm/events/compose_batches.jsonl`
- **Per-agent** `event:'decision'` 帶同一 `batch_id` 與 C1/C2 欄位

`compose_batch` 欄位：`batch_id`、`proposalIds`／`intent_ids`／`attempt_ids`／`logical_ids`（stub=`intent_id`）、`compose_verdict`、`steward_verdict`、`blocked_reasons`、`window_wait_ms`、`compose_window_ms`、`compose_batch_size`、`close_reason`、`proposer_direct_writes`(=0)、`repropose_rounds`(=0 stub)、`expected_source`、`base_digest`、`written`。

`repropose_rounds`：**stub 0**（完整 stale→repropose = P1-3／C2-out）。

## Smoke

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness

# window=100：可見 timeout 共寫 batch
node src/cli.mjs start --mode atm --atm-backend real --atm-writer steward \
  --run-id steward-c2-smoke --seed 7 --agents 4 --trials 6 --hot-ratio 1 --overlap high \
  --compose-window-ms 100 --hold-ms-min 10 --hold-ms-max 35 --tick-interval-ms 20 --force

# window=0：每個 batch size=1、close_reason=immediate
node src/cli.mjs start --mode atm --atm-backend real --atm-writer steward \
  --run-id steward-c2-w0 --seed 7 --agents 3 --trials 4 --hot-ratio 1 --overlap high \
  --compose-window-ms 0 --hold-ms-min 5 --hold-ms-max 15 --tick-interval-ms 15 --force
```

### `steward-c2-smoke`（window=100）

| 指標 | 值 |
|------|-----|
| exit | 0 |
| decisions / 含 `batch_id` | 19 / 19 |
| `compose_batch` 事件 | **17** |
| close_reason | immediate×15，**timeout×2** |
| batch sizes | 1×15，**2×2** |
| `window_wait_ms` | min≈0.01，max≈100.6（timeout 窗） |
| `proposer_direct_writes` | 0 |
| expected_source | single×15，composer_timeout_only×2 |

### `steward-c2-w0`（window=0）

| 指標 | 值 |
|------|-----|
| exit | 0 |
| `compose_batch` | **11** |
| 全部 `compose_batch_size=1` | ✅ |
| 全部 `close_reason=immediate` | ✅ |
| expected_source | window_zero×11 |

## Gaps → C3

- **C3**：獨立 oracle（完整 bytes／效果 ID）；`logical_id` 與 intent 脫鉤登記。
- Real ATM 填 `cowriters`（或等價 peer 清單）才能穩定走 `close_reason=count`。
- P1-3 re-propose 迴圈仍 stub。
