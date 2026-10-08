# REMAINING_TESTS — atm-bench 測試清單

更新：2026-10-07 11:36（Asia/Taipei）。Box only、Node 24（nvm）；沒有 CloudAgent／npm publish／Claim Plane。

## 已完成

- [x] Mock smoke（雙模式）→ `SMOKE_RESULT.md`
- [x] Dual small run（real ATM vs control，6 agents × 30）→ `COMPARE_SMALL.md`
- [x] Latency／slowdown（paced ×5、unpaced ×5）→ `COMPARE_LATENCY.md`
- [x] Cold 同檔排隊（region atomId ＋ retry overlay；8／16 agents；cold-one-file 最壞情況）→ `COLD_QUEUE_LATENCY.md`
- [x] **(1) Hot file focused**（hot_ratio 1.0／0.8、overlap high、6／8 agents、50 trials ×3；native vs hot-retry loop；sync vs stale writer；mock 參考）→ `HOT_FILE_LATENCY.md`
- [x] **(2) Multi-process 4–8 sessions small**（`run-mp`：4／6／8 個 OS process 共用 worktree ＋ ATM registry；CAS vs naive registry；apply-lock on/off）→ `MULTIPROCESS_SMALL.md`
- [x] **(3) Scale prelude**（8 agents × 200 trials ×2、× 1000 trials、unpaced 飽和、hot 1.0＋loop；single- 與 8-process）→ `SCALE_PRELUDE.md`
- [x] **v0.1.17 冷／熱重測**（tag `v0.1.17`／`ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`；run-id `v017-*`；與 Oct 6 對照）→ `V017_HOT_COLD.md`
- [x] **Harness cold_retry=native-queue**（`#admitColdLoop` 也等 `disposition=queue`；保留 `loop`=只等 true-conflict）→ `src/real-broker.mjs` 等
- [x] **#180 acceptance 實驗（無 overlay 主臂）** control／native(once)／native-queue-wait；agents 8／16×3 + one-file；wait_ms 非全 0 → `runs/v017-q180/`、`PAPER_V2_EXPERIMENT_NOTES.md`（判定 **partial pass**）

## 等 ATM（不在 harness 端實作）

- [x] **原生 cold queue／serial lane（#180 harness acceptance）** —— Issue closed；本次加 `--cold-retry native-queue`，matrix `v017-q180`（無 loop overlay）量到 wait_ms>0 與大量 `disposition=queue`。判定 **partial pass**（耐久 `enqueueSerialIntent` ticket／嚴格 FIFO 未做）。詳見 `PAPER_V2_EXPERIMENT_NOTES.md`。
- [ ] **耐久 serial ticket／官方 FIFO** —— harness 尚未呼叫 `enqueueSerialIntent`／resume；事件 `position` 多為 activeIntent blocker 數，非 ticket sequence。
- [ ] 熱檔 park／rearbitrate（ATM 訊息寫 "should be parked for rearbitration"，但沒有協定）—— 原生模式 17–24% 熱檔 intents 被 reject；目前只能用 `--hot-retry loop` overlay。可考慮併入 #180 或另開 issue（**尚未開**，需要使用者決定）。

## 下一步建議（尚未做）

- [ ] **耐久 serial queue ticket 端到端**（enqueue + eligible resume + 記錄官方 position／FIFO）—— 若論文要主張「ATM 原生 FIFO ticket」而非「harness 等 blocker」。
- [ ] **真的 composer apply**：驅動 `composeBrokerProposals`／steward apply 在真 patch 上跑，取代 `sync` writer 的「理想 rebase」假設（stale writer 顯示沒有 composer apply 時 lost 55–65%）。這是目前「0 lost update」結論最大的前提。
- [ ] 同區 composer co-write 的語意確認：core@0.1.2 會把**同 region** 的第二、第三個 writer route 到 composer（只有撞上 provisional lease holder 才 reject）—— 這是設計還是 bug，要跟 ATM 確認。
- [ ] Registry 規模：單一 JSON ＋ fail-fast `.write-lock`；unpaced 8 procs 時單一 transaction 最多重試 72 次；沒有 stale-lock 回收（process 被 SIGKILL 在 write 中間 → `.write-lock` 永遠留著）。可做 kill-9 fault-injection 測試。
- [ ] 更大規模：16 agents × 1000 trials multi-process；hot 1.0＋loop 長跑看 backlog（S2 的 schedule_lag 一直上升）。
- [ ] 真 LLM／秒級 hold（目前 hold 20–60 ms 模擬）；`tick` 外部 agent 介面仍是 stub。
- [ ] 跨機（不同 box／網路檔案系統）共享 registry —— 未測。
