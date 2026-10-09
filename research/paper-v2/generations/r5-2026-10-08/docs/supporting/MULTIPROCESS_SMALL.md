# MULTIPROCESS_SMALL — 4–8 個獨立 OS process 共用同一個 worktree + ATM registry

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei），runs 在 19:31–19:33 跑完 |
| Harness | atm-bench 0.3.0-latency ＋本次新增 `run-mp`（`src/mp-runner.mjs`、`src/mp-worker.mjs`、`src/mp-broker.mjs`） |
| ATM | `atm_backend=real`：`@ai-atomic-framework/core@0.1.2`；registry 用 ATM 自己的 `createBrokerRegistryStore(path).read()/write({base,next})`（CAS） |
| Node | v24.21.0（nvm），box only；沒有 CloudAgent／npm publish／Claim Plane |
| 原始資料 | `runs/mp-<A\|B>-<arm>-r{1,2,3}`；彙整 `runs/multiprocess/summary.{json,md}`；腳本 `runs/multiprocess/{run_matrix.sh,analyze.mjs}` |

## TL;DR

- **真的 multi-process 有跑成功**：每個 agent 是一個 `child_process.fork()` 出來的 Node process（每 rep 的 distinct pid = 6 或 8；`--procs 4` 時 4 個 process × 2 agents），全部共用**同一個** `atm/worktree/` 和**同一個** `atm/worktree/.atm/runtime/write-broker.registry.json`。沒有 shared memory／IPC 狀態（IPC 只用來對齊 t0）。0 個 worker crash、0 個 error、**結束時 registry 殘留 0 筆 active intent**（CAS 模式）。
- **ATM 的 registry store 可以跨 process 共用，但要照它的 CAS 協定用**：`read()` 拿 snapshot → 在那個 snapshot 上 `calculateBrokerDecision`＋`evaluateBrokerAdmission` → `registerIntent` → `write({ base: snapshot, next })`。衝突時 ATM 丟 `ATM_BROKER_REGISTRY_CAS_CONFLICT`，caller 要自己 reread＋**重問 ATM**。ATM 的 `.write-lock` 是 **fail-fast**（`openSync(…,'wx')`，沒有等待／沒有 stale-lock 回收），所以大部分衝突其實是「lock 正被別人拿著」。
- **成本**：同一個 scenario，multi-process 的 wall 跟 single-process 幾乎一樣（pacing-bound），但**每筆 overhead 約變 2 倍**（A：4.98 → 9.35 ms mean，p95 6.6 → 19.7 ms），因為每筆 admission/release 都要讀檔＋算 digest＋寫檔，還有 ~46% 的 transaction 至少重試一次。
- **兩個失敗模式（負面對照）都量到了**：
  1. **naive registry**（用舊 harness 的 `loadRegistry()`…`saveRegistry()`，`saveRegistry` 會在寫之前重新讀 base，所以**不是**對你評估過的 snapshot 做 CAS）→ 每 rep 結束時 registry 留下 **37 / 26 / 32 筆殭屍 lease**（release 被別的 process 的 save 蓋掉），後面的 writer 都被當成「檔案有人在寫」→ hot_provisional 從 ~50 掉到 9.3、reject 變多、overhead 變 14.6 ms。
  2. **apply-lock off**（准入照 CAS，但兩個 composer co-writer 的檔案 read-modify-write 不互斥）→ **每 rep 2 個 lost update（1.0%）**，6 筆全部都是 `composer_merge`、跨 process。single-process 時因為 RMW 在同一個 event loop 裡同步完成，這個 race 被藏起來了。

## 1. 設計

| 項目 | 做法 |
|---|---|
| process | `run-mp --procs N`：parent fork N 個 `src/mp-worker.mjs`；agent slot `s` 分到 worker `s % N`。worker 各自 import ATM TS 原始碼（init ~75–130 ms），送 `ready` → parent 廣播共同的 `t0Epoch` → 各自照 seed 排程跑 closed loop。 |
| 時間 | `performance.timeOrigin + performance.now()`（epoch ms，跨 process 可比）；wall = 所有 worker 的第一個 submit → 最後一個 decision。 |
| registry（`registry_sync=cas`，預設） | 每筆 admission、每筆 release 都是一個 transaction：`store.read()` → ATM 評估 → `registerIntent`/`releaseTask` → `store.write({base,next})`；`CAS_CONFLICT` → jitter backoff（≤ 4 ms）後 reread、**重新問 ATM**。 |
| apply | 每個檔一個 cross-process apply lock（`O_EXCL` lockfile，同步 spin），代表「composer/steward 的 apply 一次只做一個」；檔案寫入改 tmp＋rename（`ATM_BENCH_ATOMIC_WRITE=1`），避免別的 process 讀到寫一半的檔（`buildWriteIntent` 要讀檔找 region 行號）。 |
| hot/cold retry overlay | 跨 process 沒有 in-memory 的 holder promise → 改成 **poll registry**（每 3 ms）直到 ATM 登記的 blocker 消失，再重問 ATM。 |
| oracle | 所有 worker 結束後由 parent 檢查 marker（每個 agent 的 jsonl 此時又只有一個 writer）。 |
| 不變量 | 從 events 算「已 commit 的 hold 區間在同一 path（#region）上重疊」的 pair 數，含跨 process 的 pair；結束時讀 registry 的殘留 active intents。 |

## 2. 結果

### Scenario A — 跟 COMPARE_LATENCY 同一個 small scenario（6 agents × 30 trials、hot 0.4、overlap med、168 intents/rep，×3）

| arm | wall ms | thr int/s | goodput/s | commits/rep | lost/rep | rejects/rep | decision hist / rep | total mean / p95 | **overhead mean / p95** | latency p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| control single-process | 1516.6 | 110.8 | 71.4 | 168 | 59.7（35.5%） | 0 | direct_write 168 | 40.6 / 58.4 | 0.20 / 0.30 | 0 / 0 |
| control **6 procs** | 1516.2 | 110.8 | 71.2 | 168 | 60.0（35.7%） | 0 | direct_write 168 | 40.9 / 58.7 | 0.45 / 0.64 | 0 / 0 |
| ATM single-process | 1538.6 | 109.2 | 104.2 | 160.3 | **0** | 7.7 | admit 62.3 · composer 60.7 · provisional 37.3 · reject 7.7 | 44.6 / 64.3 | 4.98 / 6.62 | 2.74 / 4.06 |
| ATM **6 procs**（CAS） | 1549.5 | 108.4 | 103.7 | 160.7 | **0** | 7.3 | admit 62 · composer 59.7 · provisional 39 · reject 7.3 | 47.9 / 67.7 | **9.35 / 19.69** | 4.24 / 14.66 |

ATM 6 procs registry：每 rep 328.7 transactions、154.7 個（47%）至少重試一次、CAS conflict 478.7 次（lock-busy 444 / stale-generation 34.7）、單筆最多重試 14 次、殘留 0。

### Scenario B — 熱檔壓力（8 agents × 40 trials、hot 1.0、overlap high、282 intents/rep，×3）

| arm | wall ms | goodput/s | commits/rep | lost/rep（率） | rejects/rep | decision hist / rep | total mean / p95 | overhead mean / p95 | wait p95 / max |
|---|---|---|---|---|---|---|---|---|---|
| control single-process | 2024.0 | 40.0 | 282 | 201（71.3%） | 0 | direct_write 282 | 40.5 / 58.9 | 0.18 / 0.30 | — |
| control **8 procs** | 2024.1 | 40.0 | 282 | 201（71.3%） | 0 | direct_write 282 | 40.8 / 59.6 | 0.44 / 0.62 | — |
| ATM single-process | 2046.9 | 105.4 | 215.7 | 0 | 66.3 | composer 170.3 · provisional 45.3 · reject 66.3 | 37.1 / 65.6 | 4.43 / 7.08 | — |
| ATM **8 procs**（CAS） | 2039.0 | 99.6 | 203 | **0** | 79 | composer 153 · provisional 50 · reject 79 | 37.7 / 69.6 | **8.69 / 21.63** | — |
| ATM **4 procs × 2 agents** | 2039.2 | 100.7 | 205.3 | **0** | 76.7 | composer 153.7 · provisional 51.7 · reject 76.7 | 36.4 / 67.7 | 6.97 / 15.75 | — |
| ATM＋hot loop, single-process | 2327.3 | 121.2 | 282 | 0 | 0 | composer 239 · provisional 43 | 56.9 / 95.3 | 13.4 / 47.4 | 41 / 108 |
| ATM＋hot loop, **8 procs** | 2448.6 | 115.5 | 282 | **0** | 0 | composer 232 · provisional 50 | 62.0 / 108.2 | 21.7 / 66.1 | 59 / 281 |
| ⚠ ATM 8 procs, **naive registry** | 2132.1 | 91.8 | 195.7 | 0 | 86.3 | composer 186.3 · provisional **9.3** · reject 86.3 | 42.1 / 77.8 | 14.6 / 36.3 | — |
| ⚠ ATM 8 procs, CAS, **apply-lock off** | 2040.2 | 98.4 | 202.7 | **2（1.0%）** | 79.3 | composer 153.7 · provisional 49 · reject 79.3 | 37.6 / 69.2 | 8.68 / 21.3 | — |

| arm（mp） | distinct pids / rep | registry txns / rep | 重試過的 txns | CAS conflicts（lock-busy / stale） | 最多重試 | polls | apply-lock spins | **registry 殘留** | 同檔 / 同區 / 同區跨 process 重疊 pairs |
|---|---|---|---|---|---|---|---|---|---|
| ATM 8 procs | 8,8,8 | 485 | 225.3（46%） | 750.3（694.3 / 56） | 15 | 0 | 2.3 | **0,0,0** | 399 / 108 / 108 |
| ATM 4 procs | 4,4,4 | 487.3 | 188（39%） | 545（496.7 / 48.3） | 15 | 0 | 3 | 0,0,0 | 408 / 111 / 99 |
| ATM＋loop 8 procs | 8,8,8 | 711.7 | 340.7 | 1237.3（1127.3 / 110） | 20 | 729.7 | 4 | 0,0,0 | 567 / 122 / 122 |
| naive 8 procs | 8,8,8 | 477.7 | 205.3 | —（naive lock-busy 570.7） | 14 | 0 | 1.3 | **37, 26, 32** | 396 / 182 / 182 |
| apply-lock off | 8,8,8 | 484.7 | 224.3 | 736（678.3 / 57.7） | 18 | 0 | 0 | 0,0,0 | 381 / 101 / 101 |

注意：control 的 `racy_overwrite` 偵測是 per-process 的記憶體狀態，所以 multi-process control 的 racy 計數是 0（**不代表**沒有 race）；lost update 用 oracle 量，sp 跟 8 procs 都是 201/282。

## 3. 解讀

1. **multi-process 對正確性沒有變差（CAS 模式）**：A/B 兩個 scenario，ATM 在 4／6／8 procs 都是 **0 lost update、0 registry 殘留、0 crash**；control 的 lost rate 跟 single-process 一模一樣（35.7% / 71.3%）。
2. **但 multi-process 揭露了兩個 single-process 看不到的要求**：
   - registry 一定要用 ATM store 的 CAS（`read`→`write({base})`）＋ caller 端 retry。用 `loadRegistry`/`saveRegistry` 這組 legacy API 會丟 release、留下殭屍 lease（每 rep 26–37 筆），會一直卡住後面的 writer，直到 lease 過期（120 s）。
   - composer co-writer 的 apply 需要跨 process 互斥（或真的 3-way merge）；沒有的話就算准入正確也有 ~1% lost update。
3. **成本**：wall 不變（pacing-bound），但每筆 overhead ~2×（registry 是一個 JSON 檔：每筆 admission＋release 都要 read＋digest＋atomic write；fail-fast lock 讓近一半 transaction 要重試）。hot loop 在 8 procs 下 wait max 拉長到 281 ms（poll 3 ms ＋ CAS 重試）。single-process 跟 8 procs 的 reject 數不同（66.3 vs 79）：真平行讓重疊的時間窗變了，屬於正常變異。
4. **ATM 端的缺口**：`writeBrokerRegistrySnapshot` 的 lock 是 fail-fast、沒有 wait/backoff helper，也沒有 stale-lock 回收（process 在 write 中間死掉會留下 `.write-lock`，之後所有 writer 都會一直 CAS_CONFLICT）。原生的 park/queue 等待也不存在（GitHub #180，見 REMAINING_TESTS.md），所以 cross-process 的等待只能 poll registry。

## 4. 重跑

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
runs/multiprocess/run_matrix.sh        # ~1.5 min
node runs/multiprocess/analyze.mjs     # → runs/multiprocess/summary.{json,md}
# 單臂範例：8 個 process，各 1 agent
node src/cli.mjs run-mp --mode atm --run-id X --seed 42 --agents 8 --trials 40 --hot-ratio 1 --overlap high \
  --atm-backend real [--procs 4] [--hot-retry loop] [--registry-sync cas|naive] [--apply-lock on|off] --force
node src/cli.mjs run-mp --mode control --run-id Y --seed 42 --agents 8 --trials 40 --hot-ratio 1 --overlap high --force
```
`meta.json → modes.<mode>.mp` 有 pids、exit codes、CAS/重試計數、registry 殘留、重疊 pairs。
