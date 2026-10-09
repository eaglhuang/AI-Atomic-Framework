# COMPOSER_STEWARD_IMPL_PLAN — Composer＋Steward 共寫合成：缺口盤點與實作計畫（plan-only）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07（Asia/Taipei） |
| 模式 | **plan-only**：未改 ATM monorepo、未開 PR、未改 harness 行為碼；issue 已開 **[#196](https://github.com/eaglhuang/AI-Atomic-Framework/issues/196)**（2026-10-07） |
| 依據 | `COMPOSER_STEWARD_PAPER_PIVOT.md`、`PAPER_V2_DRAFT_PACK.md`（§2.1 C3、§4.3、§8）、`REMAINING_TESTS.md`、`HOT_FILE_LATENCY.md` |
| 程式碼樹（只讀） | `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`（tag v0.1.17）；`/workspace/AI-Atomic-Framework`（HEAD `ed317820`）。`compose.ts`、`steward-transactional-apply.ts` 兩樹 `diff -q` 相同；GitHub `main` 的 `steward-transactional-apply.ts` 讀到的內容也同（2026-10-07 讀取） |
| 新證據 | 唯讀探針（在 `/tmp` 建拋棄式 git repo，僅 import core 原始碼，不改 ATM 樹）：`runs/composer-probe/probe.mts`、`runs/composer-probe/probe.out` |

> 下文路徑若未寫前綴，ATM 檔案指 `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17/` 之下；harness 檔案指 `/workspace/reports/atm-v2-harness/` 之下。

---

## 0. 一句話結論

ATM 已有 **compose（`composeBrokerProposals`）→ merge plan → 中立 steward 交易式 apply** 整條 API，但目前 **steward 的文字合成是「按 anchor 排序後循序套 patch」**，而不是對同一個 immutable base 做 rebase。唯讀探針證實：**同檔、非重疊、但上方 patch 會改變行數**時，compose 判 `parallel-safe`，apply 卻**直接 throw**（`UnifiedPatchApplicationError`），兩個變更都沒寫進去；結果還**跟排序有關**。重疊衝突雖然檔案沒動到，但也是靠 throw，**不是可觀測的 blocked 收據**；另外**提案者自己可以當 steward**（`stewardId='agentA'` 照樣 `applied`）。所以論文要的「真正平行合併」還不能宣稱，要先補 core 的 P0。

---

## 1. 目標與論文主張

### 1.1 目標（照 PIVOT「成功方向」1–4）
1. 多 agent 對**同一個檔**的不同／可合併 region 提交**真實 unified-diff patch**（`PatchProposal`）。
2. Broker 把它們路由到 compose；**中立 steward**套用合成結果，**提案 agent 不直接寫 canonical 檔**。
3. Ground-truth：合成後保留每一方非衝突的變更；遇到不可合併的衝突就 **fail-closed，而且有可觀測的收據**。
4. 測試／腳本可重跑。

### 1.2 功能完成後才能寫的 claim（草案，數字待 M2/M3 實測後填，現在**不可**引用）
> 「在 ATM vX（frozen tag）中，被 broker 路由到 compose 的同檔多 agent 真實 patch，由中立 steward 對同一個 base 做確定性合成，並一次性交易式寫入。在 atm-bench 熱檔高壓情境（如 h1-a8）下，**非重疊變更的 lost update 為 0（oracle 驗證）**，**重疊衝突 100% fail-closed 且有 blocked 收據**，**提案 agent 對 canonical 檔的直接寫入次數為 0**。相較之下，同樣的准入決策但沒有 composer apply（stale writer）會丟 55–65%。」

- 比較基準「stale writer 55–65% lost」已有（`HOT_FILE_LATENCY.md` §2.2）；其餘數字**來源未提供**，要等 M2/M3。
- 這句會把 PAPER_V2_DRAFT_PACK C3 的 caveat「0 lost 綁 sync writer（理想 rebase）」換成「0 lost 綁**真 steward apply**」。

---

## 2. 現況：已有的 API／腳本／路徑

### 2.1 Core（`packages/core/src/broker/`）
| 元件 | 路徑:行 | 現況 |
|------|---------|------|
| `composeBrokerProposals(proposals)` | `compose.ts:34` | 排序 → CID 衝突回 `ok:false, blocked-cid-conflict`；metadata 不一致（baseCommit/fileBeforeHash）、anchor 重疊、hunk 行範圍重疊回 **`ok:true, needs-steward`**；否則 `parallel-safe` |
| 排序／hunk 範圍 | `merge-plan.ts:26-55` | 依 `targetFile → firstAnchorKey（字串）→ proposalId` 排序，**不是**依檔內行號；`parsePatchHunkRanges` 只看 `@@ -a,b` |
| applyMethod | `merge-plan.ts:75-78` | `parallel-safe→patch-apply`；其他 → `steward-authored-final-patch`（但沒有任何程式真的產生「steward 撰寫的最終 patch」，見 §3） |
| `planStewardApply` | `steward.ts:133` | 驗證：schema、blocked verdict、human-required、proposal 數量、scope lock、`validateBrokerProposal`（stale-base-commit／file-hash-drift）。**`needs-steward` 可以通過** |
| `applyStewardPlan` | `steward.ts:161` | plan → `buildPatchProposalComposition` → `buildStewardSemanticValidationReceipt` → `applyTransactionalStewardPlan(writerRole:'neutral-steward')`；會寫 evidence |
| `executeBrokerScopedWrite` | `steward.ts:236` | 先檢查 runtime activation handshake 與 allowedFiles，再呼叫 `applyStewardPlan` |
| `arbitrateStewardRequest` | `steward.ts:316` | 唯一會呼叫 `checkStewardPermission` 的地方（只檢查非空字串／derived writer 要有授權）；回 apply/merge-required/blocked/human-required |
| `buildPatchProposalComposition` | `steward-transactional-apply.ts:57` | 每個檔做 `composeProposalPatchesAgainstImmutableBase`；`serializabilityProof.permutationStable: true` **寫死**（`:116-121`），沒有真的檢查 permutation |
| 文字合成 | `steward-transactional-apply.ts:143-173` | 名稱說 "against immutable base"，但文字路徑是 `proposals.reduce((c,p)=>applyUnifiedPatch(c,p.patch), before)`（`:148`），也就是**循序套用**；只有「每個 proposal 都只有單一 json-pointer anchor」時才真的對 immutable base 合成 |
| 語意驗證收據 | `steward-transactional-apply.ts:233-244` | 自己簽發，`ok: true` 寫死 |
| 交易式寫入 | `steward-transactional-apply.ts:246-389` | 先檢查 writerRole、digest、scope、base hash（stale 就 blocked）→ 寫到 temp → 寫 canonical → 失敗就 rollback。**這段品質不錯，可以沿用** |
| `applyUnifiedPatch` | `unified-patch.ts:79` | 嚴格比對 context，對不上就 throw `UnifiedPatchApplicationError`（`ATM_UNIFIED_PATCH_CONTEXT_MISMATCH`） |
| 結構化 composer（另一條路） | `transactional-composer.ts:68 composeTransactionalMutations`；`adapters/text-range.ts`（只支援 `.md/.txt`，`:93-96`）、json-record | 吃 `MutationRequest`（不是 PatchProposal）；有 canMerge／skipped／returnedQueueRequestIds。可以當設計參考 |
| Admission → compose | `admission/evaluate-broker-admission.ts:48-49`（`deterministic-composer`／`neutral-steward` lane → `compose`）；`decision.ts:228`、`decision/proposal-overlap.ts:96`（`composer-routed`） | 准入只決定「要走 compose」；**沒有任何東西在准入之後自動收集 proposal、觸發 compose 和 steward apply** |
| Steward queue（runner sync） | `runner-sync-steward-queue.ts:98/219/303` | 是 runner-sync 的佇列，跟 compose window 無關（只列為參考） |

### 2.2 CLI（`packages/cli/src/commands/broker/`）
- `atm broker compose`：`steward-runtime-actions.ts:316-351`（可 `--persist-merge-plan`）。
- `atm broker steward plan|apply`：`steward-runtime-actions.ts:68-177`；`stewardId` 預設 `'neutral-write-steward'`（`:63`），**沒有檢查 steward ≠ 提案 actor**。
- `atm broker runtime activate`（handshake＋scoped write）：`:182-314`。
- 其他會呼叫 compose/steward 的地方：`route/takeover.ts:70`、`git-governance/implementation/admission-command.ts:153-162`（單一 proposal）。

### 2.3 Validators（GitHub `scripts/` 與本機同名檔）
| 腳本 | 涵蓋 | 沒涵蓋 |
|------|------|------|
| `scripts/validate-broker-compose.ts`（205 行） | 排序確定性、disjoint→`parallel-safe/patch-apply`、CID→fail-closed、metadata/anchor/hunk overlap→`needs-steward`、CLI 缺檔、transactional composer（`:119-203`） | **只測 compose verdict，沒有把兩個 proposal 真的 apply 到檔案上** |
| `scripts/validate-broker-steward.ts`（365 行） | **單一 proposal** apply、scope-lock/hash-drift/stale/blocked plan、CLI plan/apply、evidence schema（`:195-360`） | 同檔多 proposal 合成、needs-steward 行為、提案者自我 apply |
| 其他相關 | `validate-broker-proposal.ts`、`validate-brokered-write.ts`、`validate-team-brokered-write/proposal-flow.ts`、`validate-broker-native-serial-queue.ts` | — |

### 2.4 文件
- `docs/BROKER_GUIDE.md`（184 行）：`:18` `needs-physical-split→deterministic-composer`；`:27-30` compose 邊界；`:76` `composer-routed`；`:86` 「disjoint regions can route to composer, overlapping regions remain blocked」；`:123` 說 steward-composed writes 會走 post-compose semantic validation。**目前程式碼的行為比文件描述弱**（見 §3）。

### 2.5 Harness（atm-bench）
- `src/real-broker.mjs:97-98`：`compose → composer_merge`，只是貼個標籤，沒有驅動 compose/steward。
- `src/runner.mjs:20-21`：`atm_writer: sync`（apply 當下 read-modify-write = 理想 rebase）／`stale`（沒有 composer）。
- `HOT_FILE_LATENCY.md` §1.1：core 會把**同 region** 的後續 writer 也 route 到 composer（h1-a8 每 rep 同區重疊 pairs native 156，全部是 composer＋composer）。

### 2.6 唯讀探針結果（`runs/composer-probe/probe.out`，v0.1.17 core，10 行檔）
| # | 情境 | compose verdict | apply 結果 | 檔案保留 A / B |
|---|------|------|------|------|
| 1 | 不重疊，兩邊都是等長替換（第 2、8 行） | parallel-safe / patch-apply | applied | ✅ / ✅ |
| 2 | 不重疊，**排在前面的 patch 在上方而且插入 1 行** | parallel-safe / patch-apply | **throw** `context mismatch at line 8: expected "line8", found "line7"` | ❌ / ❌ |
| 3 | 同 #2 的 patch，但 anchor 讓下方 patch 先排 | parallel-safe / patch-apply | applied | ✅ / ✅ |
| 4 | 重疊（兩邊都改第 5 行） | needs-steward / steward-authored-final-patch | **throw**（不是 blocked 收據） | ❌ / ❌（檔案沒變） |
| 5 | `stewardId='agentA'`（就是提案者本人） | parallel-safe | **applied** | — |

→ #2 跟 #3 只差排序，結果就不同，代表合成**跟順序有關**；`permutationStable:true` 是寫死的假證明。#4 雖然檔案沒動（等於 fail-closed），但是是用例外中斷，CLI／harness 拿不到 `verdict:'blocked'` 和衝突明細。

---

## 3. 缺口清單

### P0（不補就不能宣稱共寫合成）— 共 **6** 條
| ID | 層 | 缺口 | 證據 | 修正方向（建議，不是定案） |
|----|----|------|------|------|
| **P0-1** | core | 文字合成是循序 reduce，不是對 immutable base 合成；行數位移讓不重疊的 patch 失敗，而且結果跟排序有關 | `steward-transactional-apply.ts:148`；探針 #2/#3 | 對同一個 base 解析所有 hunk → 確認互不重疊 → 依**檔內行號**由下往上套用（或累積 offset 平移）；**真的**跑 permutation（N≤k 全排列，或「依位置排序＋不重疊」的證明），把 `permutationStable`、`checkedPermutationCount` 改成實際值 |
| **P0-2** | core | 合成失敗用 throw，沒有結構化的 blocked 收據 | `buildPatchProposalComposition` 沒有 try/catch；探針 #2/#4 | 在 composition 捕捉 `UnifiedPatchApplicationError` → `applyStewardPlan` 回 `ok:false, verdict:'blocked'`，帶 `blockedReasons`（例如 `compose-context-mismatch`）＋衝突 proposalId；**絕對不做部分寫入** |
| **P0-3** | core | `needs-steward` 會被當成可以自動 apply（`planStewardApply` 放行），但沒有「steward 撰寫的最終 patch」這個實作 | `steward.ts:416-419` 只擋 blocked/human-required；`merge-plan.ts:75-78` | 規則：`needs-steward` 而且沒有附 steward-final-patch → **fail-closed**（`blocked`，code 例如 `steward-final-patch-required`），列出 conflicts，退回提案者 re-propose。真的「steward 解衝突」放 P2 |
| **P0-4** | core＋CLI | 提案者可以自己當 steward（自我覆寫） | `applyStewardPlan`／`executeBrokerScopedWrite` 沒呼叫 `checkStewardPermission`；CLI `:63` 可以任意帶 `--steward-id`；探針 #5 | apply 路徑一律檢查：`stewardId ∉ proposals[].actorId`，而且 identity.kind=`neutral`；違反就 `invalid-steward-identity` blocked。CLI 也要套同一個檢查 |
| **P0-5** | harness | atm-bench 沒驅動真的 compose/steward；composer_merge 的 0 lost 綁 sync writer | `real-broker.mjs:97-98`、`runner.mjs:20-21`；DRAFT_PACK §4.3／§8.2 P1 | 新增 writer 模式（例如 `--atm-writer steward`）：composer_merge 的 intent 對 fixture（要是 git repo）產生真實 unified diff `PatchProposal`（帶 baseCommit/fileBeforeHash/anchors/atomRefs）→ 每個檔一個 compose window 收集 → `composeBrokerProposals` → 中立 steward `applyStewardPlan` → 事件記錄 verdict/blockedReasons/re-propose 次數；oracle 不改 |
| **P0-6** | 測試 | ATM validators 沒有「多 proposal 真 apply」的驗收 | §2.3 | 在 `validate-broker-steward.ts`（或新的 `validate-broker-cowrite.ts`）加入 §5 的 S1–S4（兩種排序都要測），並註冊到 validators.config |

### P1（論文可信度／工程完整）
| ID | 層 | 缺口 |
|----|----|------|
| P1-1 | core | 語意驗證收據自己簽發而且 `ok:true` 寫死（`steward-transactional-apply.ts:233-244`）；要接 `post-compose-semantic-validation-policy.ts`／proposal validators（BROKER_GUIDE `:123` 已經這樣宣稱） |
| P1-2 | core／harness | **Compose window／觸發語意**：准入回 compose 之後，誰在什麼時候把同檔 proposal 收齊、交給 steward？（時間窗、N 個 proposal、或 holder release）。目前只有手動 CLI。要定義清楚並記錄等待成本 |
| P1-3 | core／harness | **Stale proposal 的 re-propose 迴圈**：前一輪 steward 寫入後，檔案 hash 變了 → 後到的 proposal 會碰到 `file-hash-drift`／metadata mismatch。要定義「退回 → 在新 base 重新產生 patch → 重新 compose」，並量 rounds |
| P1-4 | core | 決策層把**同 region** 的第二、三個 writer route 到 composer（`HOT_FILE_LATENCY.md` §1.1）。要確認這是設計還是 bug；P0-3 修完後，這些會全部變成 fail-closed → 是否要在准入就改成 queue/park？ |
| P1-5 | harness | multi-process（`run-mp`）的 steward apply：跟 registry CAS／per-file apply lock 的互動；負面對照沿用 T8 的方法 |
| P1-6 | 文件 | `BROKER_GUIDE.md` 補「Compose & steward apply」一節：verdict 與 apply 的對照表、fail-closed code、提案者≠steward、re-propose |
| P1-7 | CLI | `atm broker steward apply` 沒有 runtime handshake 時，會走 `directApplyResult`（`:109-118`），要確認是否也該要求 handshake／identity |

### P2（之後再說／Future Work）
- P2-1：真正的 steward-authored final patch（人或 LLM 解 `needs-steward` 衝突），要附審核收據。
- P2-2：symbol／AST-anchored（adapter-guided）合成，取代純行號；接 Derived Atoms（CID v2）的 atom 邊界。
- P2-3：text-range adapter 擴到 `.ts` 等語言，或統一 `PatchProposal` 與 `MutationRequest` 兩條 composer 路徑。
- P2-4：規模（單 JSON registry 瓶頸）、跨機。

---

## 4. 實作階段（M0–M3）

| 里程碑 | 產出 | 驗收標準 | 依賴 |
|--------|------|----------|------|
| **M0 規格＋紅燈測試** | ① 開 GitHub issue（§9 正文）；② 在 ATM 加 S1–S4 驗收測試（預期**紅燈**：S1b、S2、S3 會失敗）；③ 把探針轉成 fixture | 在 v0.1.17 上，測試精準重現 §2.6 的 #2、#4、#5；S1a（等長替換）綠燈 | 需要 ATM repo 寫入權（PR，不 merge 由使用者決定）；或請別人在 Cloud 實作 |
| **M1 Core P0（P0-1～4）** | `steward-transactional-apply.ts` 改成對 base 合成＋真的 permutation 檢查；compose 錯誤 → blocked 收據；needs-steward fail-closed；steward identity gate（core＋CLI） | S1–S4 全綠，兩種排序結果的 byte hash 相同；既有的 `validate-broker-compose`、`validate-broker-steward`、candidate-bridge、`validate-broker-native-serial-queue` 不退化；交易式 apply 的 rollback 測試（`failAfterWrites`）仍然通過 | M0；建議 M1 完成後打 frozen tag（例如 v0.1.18，**是否 publish 由使用者決定**） |
| **M2 Harness 接線（P0-5，＋P1-2/P1-3 最小版）** | `--atm-writer steward` 臂；fixture 變成 git repo；proposal 產生器；compose window；事件欄位 `steward_verdict`、`blocked_reason`、`repropose_rounds`、`proposer_direct_writes`；analyze 腳本 | h1-a8／h1-a6／h08-a8 ×3 reps：steward 臂 **lost=0**、**proposer_direct_writes=0**、重疊衝突全部有 blocked 收據（0 次 silent overwrite、0 次例外中斷 run）；同時報 control／sync／stale 對照 | M1（或用 `ATM_MONOREPO` 指向 M1 branch 的 checkout） |
| **M3 論文級證據** | mp 臂（P1-5）；延遲成本（compose window wait、steward apply ms、re-propose rounds）；KEY_TABLES 新表；`BROKER_GUIDE` 更新（P1-6）；語意驗證接線（P1-1，最好有） | 4/6/8 procs 0 lost、0 registry 殘留；表格附 run-id/seed/tag；DRAFT_PACK C3 caveat 改寫 | M2 |

---

## 5. 驗收場景（最少要有，M0 寫成測試、M2 寫成 bench 斷言）

| ID | 場景 | 期望 |
|----|------|------|
| **S1a** | 同檔、不重疊、兩個等長替換 patch | compose `parallel-safe`；steward `applied`；最終檔案**同時有 A、B 的變更**，其他行不變 |
| **S1b** | 同檔、不重疊、**上方 patch 插入或刪除行**；用兩種 anchor 排序各跑一次 | 兩種排序都 `applied`，A、B 都保留，**兩次的輸出 byte hash 相同**（現況：其中一種排序會 throw） |
| **S2** | 同檔、重疊 hunk（同一行不同內容） | compose `needs-steward`；steward 回 **`ok:false, verdict:'blocked'`**，帶 conflict 明細與 proposalId；canonical 檔 hash 不變；**不 throw** |
| **S3** | 提案者不能直接覆寫：`stewardId` 等於任一 proposal 的 `actorId`（API 與 CLI 各測一次） | `blocked` + `invalid-steward-identity`；檔案不變 |
| S4 | stale：canonical 檔在 compose 之後被改 | `canonical target base hash is stale`／`file-hash-drift` → blocked，可以 re-propose（現有行為，當回歸測試） |
| S5 | 部分失敗 rollback（`failAfterWrites`，多檔） | `rolled-back`，所有檔還原（現有行為，回歸） |
| S6（bench） | h1-a8 steward 臂 | lost=0、proposer_direct_writes=0、blocked 都有收據、re-propose rounds 分佈可量 |

---

## 6. 與冷熱准入／#180 的關係（支撐，不搶主軸）

- **分工**：hot/cold admission（C1）決定「誰要走 compose」；冷檔 serial queue（#180，C2）處理「同一個 atom 一定要排隊」；**Composer＋steward 處理「同檔不同 region 真的平行合併」**，是 v2 主貢獻。
- 冷熱數據的定位：當作 **admission 成本與正確性前提**（C3/C4 的 ~5 ms/intent、熱檔 wall 1.01–1.02×）和**對照臂**（control、stale）。stale 55–65% lost 正好說明「准入本身不等於不丟更新，需要 steward apply」，是主軸的動機證據。
- #180 維持 **partial pass**；耐久 ticket／FIFO 不放進本計畫範圍。熱檔 park（C9）跟 P1-4 有交集：P0-3 修好之後，同 region 撞車會從「被 composer 默默吞掉」變成「可觀測的 fail-closed」，之後要不要 park/queue 另外決定。
- #184 FileHeat／EMA：無關，仍然是 future work。

---

## 7. 風險與不做清單

### 7.1 風險
| 風險 | 緩解 |
|------|------|
| 純行號合成在相鄰 hunk（context 行交疊、但變更行不交疊）時邊界模糊 | 定義「重疊」用 **變更行＋context 行**都不交疊（保守），交疊就 S2 fail-closed；測試要有相鄰案例 |
| P0-3 讓 h1 情境大量 fail-closed（同區撞車目前每 rep 約 156 pairs），成功率下降 | 這就是要誠實揭露的東西；搭配 P1-3 re-propose 量 rounds；論文同時報「正確性」與「重試成本」 |
| compose window 引入新的等待，wall 變大 | M2/M3 量 window wait；跟 sync（理想）、stale（無合成）三臂對照 |
| 版本混淆（package.json 仍寫 0.1.2） | M1 打 frozen tag，論文寫 tag＋commit |
| harness 驅動 ATM 時把 fixture 改成 git repo，可能影響既有 run | 新臂獨立 worktree；既有臂預設行為不變（沿用之前「可逆、預設不變」的原則） |

### 7.2 不做
- 不 merge PR、不 npm publish、不打 tag（都要使用者明示）。
- 不做 ChangeIntent／JIT 時序辯論；不跟 Claim Plane 同表硬比。
- 不做 LLM 自動解衝突（P2-1）、不做 AST 全面化（P2-2）。
- 不碰耐久 serial ticket／FIFO（#180 剩下的部分）、熱檔 park 協定、#184 heat-weight。
- 本計畫階段不改 harness 行為碼、不改 ATM 樹（探針只放在 `runs/composer-probe/`，是只讀 import 的證據腳本）。

---

## 8. 下一步：什麼時候重啟實作

1. **現在（plan-only）**：主代理用 cursor-github 依 §9 開 issue（本子代理沒開）。
2. **M0＋M1 適合交給 Cloud Agent 或其他人雲端實作**：範圍集中（`steward-transactional-apply.ts`、`steward.ts`、CLI `steward-runtime-actions.ts`、validators 1–2 支），驗收是確定性的單元／validator 測試，不需要 box 上的 bench。等使用者額度允許、或有人認領 issue 就可以開工。
3. **M2／M3 建議在本機 box 做**：harness 只在 `/workspace/reports/atm-v2-harness`，要用 nvm Node 24 和既有的 run 腳本；條件是 M1 branch 能 checkout 成 `ATM_MONOREPO`。
4. 重啟的觸發條件：① issue 已開且使用者同意範圍；② 使用者明示允許開 PR（仍然不 merge）；③ 額度允許（M0＋M1 一次 Cloud session、M2 一次本機 session 比較合理，實際工時**來源未提供**）。

---

## 9. Issue 正文建議（已開：**[#196](https://github.com/eaglhuang/AI-Atomic-Framework/issues/196)**）

**標題草案**
> `Composer+Steward co-write: steward apply must compose same-file disjoint patches against one base, fail closed on overlap, and forbid proposer self-apply`

（中文備選：`Composer＋Steward 共寫合成：同檔非重疊 patch 須對同一 base 合成、重疊須 fail-closed、禁止提案者自我 apply`）

**建議 labels**（若 repo 有）：`broker`、`steward`、`bug`、`enhancement`

**Body（可直接貼）**

```markdown
## 背景
ATM 已有 compose → merge plan → neutral steward transactional apply 整條路徑
（`composeBrokerProposals`、`planStewardApply`／`applyStewardPlan`、`applyTransactionalStewardPlan`）。
atm-bench 目前的熱檔「0 lost update」只建立在理想的 sync writer 上；沒有 composer apply 的 stale writer 會丟 55–65%。
要宣稱「同檔多 agent 真正平行合併」，steward apply 本身必須正確。

## 已重現的問題（tag v0.1.17，main 上 `steward-transactional-apply.ts` 內容相同）
唯讀探針：兩個 PatchProposal、同一個 10 行檔、同一個 baseCommit／fileBeforeHash：

| 情境 | compose verdict | steward apply |
|---|---|---|
| 不重疊，等長替換（第 2、8 行） | parallel-safe | applied ✅ |
| 不重疊，排在前面的 patch 在上方而且插入 1 行 | parallel-safe | **throws** `UnifiedPatchApplicationError: patch context mismatch at line 8` ❌ 兩個變更都沒寫入 |
| 同樣兩個 patch，但 anchor 排序相反 | parallel-safe | applied ✅（結果跟順序有關） |
| 重疊（同一行） | needs-steward | **throws**（沒有 blocked 收據） |
| `stewardId` 等於提案者的 actorId | parallel-safe | applied（自我 apply 沒被擋） |

根因：
- `packages/core/src/broker/steward-transactional-apply.ts` `composeProposalPatchesAgainstImmutableBase`：文字路徑是
  `proposals.reduce((c,p) => applyUnifiedPatch(c, p.patch), before)`，是循序套用，不是對 immutable base 合成；
  排序是 `firstAnchorKey` 字串（`merge-plan.ts`），不是行號。`serializabilityProof.permutationStable: true` 是寫死的。
- `buildPatchProposalComposition` 沒有捕捉 `UnifiedPatchApplicationError`。
- `planStewardApply` 會放行 `needs-steward`，但沒有「steward 撰寫的最終 patch」實作。
- `applyStewardPlan`／`executeBrokerScopedWrite`／CLI `broker steward apply` 都沒有檢查 steward ≠ proposal actor
  （`checkStewardPermission` 只在 `arbitrateStewardRequest` 被呼叫）。

## 目標
被 broker 路由到 compose 的同檔多 agent patch，由中立 steward 對同一個 base 做確定性合成、一次交易式寫入；
不重疊的變更全部保留；重疊 fail-closed 而且有收據；提案者不能直接寫 canonical 檔。

## P0 範圍
1. **對 base 合成**：所有 hunk 都對同一個 base 解析，檢查不重疊（變更行＋context），依檔內位置套用（或做 offset 平移）；
   真的檢查 permutation 穩定性（不同輸入順序 → 輸出 byte hash 相同）。
2. **用結構化 blocked 取代 throw**：合成錯誤 → `applyStewardPlan` 回 `ok:false`、`verdict:'blocked'`，
   帶 `blockedReasons`（例如 `compose-context-mismatch`）＋proposalId；絕不部分寫入。
3. **`needs-steward` fail closed**：沒有附 steward-authored final patch 時，回 blocked（例如 `steward-final-patch-required`）並列出 conflicts。
4. **Steward identity gate**：apply 路徑（core＋CLI）在 `stewardId` 屬於任何 proposal 的 `actorId`，或 identity 不是 neutral 時拒絕
   （`invalid-steward-identity`）。
5. **測試**：擴充 `scripts/validate-broker-steward.ts`（或新增 `validate-broker-cowrite.ts`），加入下列驗收場景並註冊到 validators.config。

## 驗收標準
- S1a 同檔不重疊等長替換 → `applied`，兩邊變更都在。
- S1b 同檔不重疊，上方 patch 會改變行數；兩種 anchor 順序都 `applied`、兩邊變更都在、**輸出 hash 相同**。
- S2 重疊 hunk → `ok:false`、`verdict:'blocked'`、有 conflict 明細、canonical hash 不變、**不 throw**。
- S3 `stewardId` == proposal actorId（API 和 CLI 各一次）→ blocked `invalid-steward-identity`，檔案不變。
- 回歸：stale base hash／file-hash-drift 仍然 blocked；`failAfterWrites` rollback 仍然還原；
  既有 `validate-broker-compose`、`validate-broker-steward`、candidate-bridge、native-serial-queue validators 全綠。

## 不做
- 不做 LLM／人工自動解衝突（steward-authored final patch 只要定義 fail-closed 介面）。
- 不做 AST 全面化、不改 hot/cold admission 決策（同 region → composer 的路由語意另外討論）。
- 不碰 durable serial ticket／FIFO（#180 剩下的部分）、熱檔 park、#184 heat-weight。
- PR 可以開，**不 merge、不 npm publish、不打 tag**，除非 maintainer 明示。

## 參考
- 計畫：`COMPOSER_STEWARD_IMPL_PLAN.md`（atm-bench 報告區）
- 探針：`runs/composer-probe/probe.mts`、`probe.out`
```

---

## 10. 來源
- PIVOT／DRAFT_PACK／REMAINING_TESTS／HOT_FILE_LATENCY：本目錄。
- ATM 原始碼行號：以 v0.1.17 本機樹為準（§2）；GitHub main 只核對了 `steward-transactional-apply.ts`。
- 探針：`runs/composer-probe/probe.mts`（Node v24.21.0，`ATM=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17 node probe.mts`）、`probe.out`。
