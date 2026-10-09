# C1 — `--atm-writer steward` smoke note

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 21:17 Asia/Taipei（CST, UTC+8） |
| ATM_MONOREPO SHA | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（#198 merge） |
| 本機路徑 | `/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| Harness | `/workspace/reports/atm-v2-harness`（不在 GitHub ATM monorepo） |
| Node | v24.21.0 |

## Compose window（最小 P1-2）

- Per **target file** one in-process window (`ComposeWindowManager`).
- Close when: `expectedCount` reached（mock `cowriters.length+1`，或非 composer → `1` 立即關）, **或** `compose_window_ms`（預設 80；CLI `--compose-window-ms`；smoke 用 100）.
- Real ATM `composer_merge`：無 cowriters 欄位 → `expectedCount=99`，實務上靠 timeout 收齊同窗 proposal.
- On close: `composeBrokerProposals` → `applyStewardPlan` with `stewardId=neutral-write-steward`（≠ 任一 `actorId`）.
- Blocked（overlap / identity / hash-drift / exception）→ `outcome:'blocked'`，不 throw；oracle 標 `steward_blocked_absent`（不計 lost_update）.
- `repropose_rounds` stub = 0（C2/P1-3）.
- Multi-process：compose window **不跨 process**（C1 範圍外；mp-worker 僅 pass-through params）.

## Smoke commands

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness

# Steward arm
node src/cli.mjs start --mode atm --atm-backend real --atm-writer steward \
  --run-id steward-c1-smoke --seed 7 --agents 4 --trials 8 --hot-ratio 1 --overlap high \
  --hold-ms-min 10 --hold-ms-max 40 --jitter-ms 10 --compose-window-ms 100 --tick-interval-ms 25 --force

# Sync regression (behavior unchanged)
node src/cli.mjs start --mode atm --atm-backend real --atm-writer sync \
  --run-id steward-c1-sync-reg --seed 7 --agents 3 --trials 5 --hot-ratio 1 --overlap high \
  --hold-ms-min 10 --hold-ms-max 30 --jitter-ms 5 --tick-interval-ms 20 --force
```

## Key metrics（`steward-c1-smoke`）

| 指標 | 值 |
|------|-----|
| exit | 0 |
| intents / committed / blocked | 25 / 25 / 0 |
| `atm_writer` | `steward`（全部 decision） |
| `proposer_direct_writes` | **0**（sum） |
| `steward_verdict` | applied ×25 |
| `compose_verdict` | parallel-safe ×25 |
| compose_batch_size | 1×21, **2×4**（兩批共寫） |
| `composer_merge` | 5（皆 applied） |
| oracle lost_updates | **0**（25× marker_present） |
| 共寫檔 marker | `src/store.ts` / `src/config.ts` 兩 agent marker 皆在 |

## Sync regression（`steward-c1-sync-reg`）

| 指標 | 值 |
|------|-----|
| exit | 0 |
| `atm_writer` | `sync` |
| committed | 14；lost 0 |

## 依賴備註

Steward apply 會經 ATM `proposal.ts` 載入 **ajv**（schema）。Harness `package.json` 已列 `ajv`／`ajv-formats`；ATM pin 樹可 symlink `node_modules/ajv*`（不改 ATM 原始碼）。

## Gaps → C2 / C3 / C4

- **C2**：window 語意精煉（依 ticket 預期 cowriter、holder release、等待成本事件）；re-propose 迴圈.
- **C3**：完整 bytes／效果 ID oracle（不只 marker）.
- **C4**：診斷臂 raw overwrite／admission-only／ideal sync 對照包裝.
