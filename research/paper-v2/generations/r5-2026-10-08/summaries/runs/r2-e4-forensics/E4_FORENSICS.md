# E4 lost-result 鑑識（r2 P0-1）— **反例成立（counterexample），DRAFT，不宣稱勝出**

時間：2026-10-08 CST（Asia/Taipei）。ATM pin `5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀）。r1 原 cell 未修改。

## 1. 結論（一句話）
r1 E4 `main_steward_mp` p2／seed 17／scheduler 1017 的 lost=1 **不是 oracle 或計數假象**，而是**真實的多 process 正確性失敗**：兩個 OS process 各自跑一個「中立 steward」，對同一檔的 compose→stale-check→寫入互相交錯，後寫者以舊 base 合成的內容覆蓋了前寫者已 ack 的效果（lost update）；在另一次重播中還出現兩個非原子 `writeFileSync` 同時寫入造成的**撕裂檔（torn write）**。依論文停止規則，記為反例；E4 的 MP 正確性結論撤回。

## 2. r1 原 cell 的逐步證據（`runs/e4-hot_conflict-steward-p2-s17/`，唯讀分析）
| 步驟 | 證據 |
|------|------|
| 遺失的效果 | `s17-t000-i0`（logical `log:s17-t000:i0`，`src/store.ts` region `reducers`，agent `cursor:mock-s0`，worker 0／pid 611058），terminal=commit、steward_verdict=applied，最終 bytes 中出現次數 0 |
| 同時寫入者 | `s17-t000-i6`（`other:mock-s7`，worker 1／pid 611059），同檔同 region，4 ms 後 commit |
| 兩者的 proposal base | 皆為 fixture base `sha256:3c1ad38d…`（`artifacts/proposals/*.json` 的 `fileBeforeHash`） |
| worker 1 的 ATM 收據 | `fileBeforeHashes=a6574603…`＝**base＋i0**（重算確認）；`fileAfterHashes=56c43e5a…`＝**base＋i6**（重算確認） |
| 意義 | worker 1 在 base 上 compose 並通過 stale check，之後 worker 0 寫入 base＋i0；worker 1 寫入前重讀到 base＋i0（收據 beforeHash），仍寫入以 base 合成的 base＋i6 → i0 被覆蓋 |
| apply-lock | 兩個 worker `apply_lock_spins=0`：`--apply-lock on` **從未包住 steward 路徑**（`src/runner.mjs` r1：steward 分支不呼叫 `withApplyLock`，只有非 steward 分支 L306 有） |
| 收據稽核缺口 | batch id 是每 process 自己的計數器 → 兩個 process 都產生 `cb-src_store.ts-0001`，`artifacts/steward/cb-src_store.ts-0001.json` 被 worker 1 覆蓋，worker 0 對 i0 的 steward 收據**遺失**。r1 E4 15 個 MP cells 中 14 個有跨 process 同名 batch id |
| 連帶發現 | r1 的 `fault_nolock`（apply-lock off）消融對 steward 是**無效消融**——與主臂相同（皆未加鎖） |

## 3. 根因分層
1. **Harness 整合缺陷（主因）**：MP 拓撲讓每個 OS process 各有一個 steward／ComposeWindowManager，`--apply-lock on` 卻沒有包住 steward compose＋apply；論文「單一中立 steward」不變式在 E4 拓撲中被違反。
2. **ATM pin 的單 process 假設（貢獻因）**：`applyTransactionalStewardPlan`（`steward-transactional-apply.ts` L312–359）是 check-then-write：stale check、temp 物化、重讀、`writeFileSync` 之間沒有跨 process 鎖或原子 CAS；寫入非原子（無 tmp＋rename）。收據的 `beforeHash` 與合成 base 不同時**仍判 applied**。單 process 內 apply 為同步呼叫，不會交錯；跨 process 就會。這是 ATM 介面契約需明文的前提（或需加跨 process 守衛），**不在本步修改 ATM**。
3. **Oracle**：r1 presence oracle 對 lost 判定正確（效果確實不在）；但 r1 oracle 看不到 torn write 造成的多餘 bytes——v2 oracle 以 frame 檢查抓到（見 §4）。

## 4. 確定性重播與緩解（新 run id，`runs/r2f-e4-*`；腳本 `runs/r2-e4-forensics/run_forensics.sh`）
同一 workload（scenario hash `3eec787f…` 與 r1 相同）、同參數；MP 時序本質非確定，故以重複估計發生率。新增遙測：每次 steward apply 的 pre-apply hash、ATM 收據 before/after、post-apply hash、epoch 起訖、pid；batch id 加 worker 前綴（不再碰撞）。

| 設定 | runs | 失敗 runs（v2：lost/frame/duplicate>0） | lost 效果 | torn／frame 違規檔 | 有競態特徵的 runs | steward lock spins |
|------|-----:|-----:|-----:|-----:|-----:|-----:|
| r1 設定（`--apply-lock on`，steward 未加鎖） | 75 | **4** | 6 | 1 | 4 | 0 |
| r2 候選緩解（`--steward-apply-lock on`） | 75 | **0** | 0 | 0 | 0 | >0（鎖確實生效） |

- 精確 cell（p2／s17／1017）30 次重播：1 次失敗（lost `s17-t002-i4`、`s17-t002-i6`）；同設定的 grid p2／s17 另 5 次中 1 次失敗（lost 正是 r1 的 `s17-t000-i0`＋`s17-t002-i5`，且 `store.ts` 末端多一個 `\n`）。即同設定 35 次中 2 次失敗。
- 失敗 runs 4/4 都帶競態特徵；無失敗 runs 0 個帶特徵（r1 設定）；緩解設定 0/75。
- **torn write 逐位元重現**：`r2f-e4-p2-s17-g-r1cfg-r4` 的 `store.ts` post-hash `04f1d540…` ＝ base＋i6（699 bytes）覆寫在 base＋i0（700 bytes）上留下最後 1 byte `\n`。兩個 process 都讀到 base、都通過 stale check、幾乎同時寫入。
- p4／p8 在各 5×3 次重播中未觀察到失敗——**不代表**較安全，樣本小、時序不同。
- 緩解的成本（作者報告值，平均）：p2 wall 572→609 ms、p4 621→700 ms、p8 687→907 ms；correct 每 run 21.2→22.1（p2）、20.0→19.7（p4）、18.8→21.1（p8）。

## 5. 對論文的影響（停止規則）
- E4「MP 主臂零遺失」不可再寫；F2 的 p8 lost=0 選摘必須改為整體：r1 主臂 9 cells 中 1 cell lost=1；r2 重播 r1 設定 75 runs 中 4 runs 失敗。
- 「CAS＋apply-lock on」的 MP 主臂標籤在 r1 是**錯誤描述**：steward 路徑沒有被 apply-lock 保護。
- 緩解（harness 側 steward 跨 process 鎖）在 75 次重播中 0 失敗，但這是**候選**，不是證明；正確做法是：(a) 部署契約明定「每個 canonical root 只能有一個 steward 寫入者」或 (b) ATM 端提供跨 process 原子 CAS／鎖並在 receipt beforeHash≠base 時 fail-closed。任一項都需要新的契約測試（review 第二階段 D：2 process barrier 交錯）。
