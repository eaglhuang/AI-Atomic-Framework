# W4 讀碼稽核：pre-edit claim / lease（prereg v3 ATM arm）

- 日期：2026-10-31（Asia/Taipei）
- 讀碼基準：`AI-Atomic-Framework-gov` checkout `3950307cf`（只讀；沒有改任何檔案、沒有跑實驗或付費模型）
- 對應：`prereg-v3-design-draft.md` §2.1 D1/D2、L238 事件 log、L310 W4（原估 2–4 天）

## 0. 結論（先講）

**Verdict：extend（不是 reuse as-is，也不必從零 build new）。**
以 **Write Broker registry（lease）＋ resource-overlap（偵測）＋ live-write steward（`broker steward apply-live`，#360/#363/#364）** 為底，
加一層薄的 **file-level claim 指令＋share 模式政策＋append-only 事件 log**。

**W4 修正估計：3–5 天**（原估 2–4 天；多出來的是「share 模式要繞過現有 queue/block 語意」和「事件 log 現在沒有」）。

| 子項 | 估計 |
|---|---|
| W4.1 薄 `claim --files` / `release` / `renew` 包裝（自動產生 WriteIntent） | 0.5–1 天 |
| W4.2 share-and-steward 政策模式（overlap 不排隊、不縮範圍，回 `CLAIM_OVERLAP`） | 1 天 |
| W4.3 holder 早期通知（piggyback 在下一個 atm 指令輸出） | 0.5 天 |
| W4.4 append-only 事件 log（claim / overlap / grant / renew / release / expiry / steward accept-reject / ack） | 0.5–1 天 |
| W4.5 P1：未 claim 檔第一次寫入偵測（接在 apply-live 入口） | 0.5 天 |
| W4.6 測試＋ N 個 Codex actor 身分設定 | 0.5–1 天 |
| W4b symbol-level claim（之後） | 另估 1–2 天（atomRanges / line-range 已有基礎） |

## 1. 逐一機制

欄位：做什麼／在哪／任意 actor 可用？／overlap 共享？／早期通知 holder？／事件 log？／缺口

### 1.1 Write Broker（registry + lease）— **主要可重用**
- 做什麼：WriteIntent（taskId, actorId, baseCommit, targetFiles, atomRefs, sharedSurfaces, requestedLane, leaseBounds…）登記到 registry；ActiveWriteIntent 帶 leaseEpoch / leaseSeconds / leaseMaxSeconds / heartbeatAt / expiresAt。
- 在哪：`packages/core/src/broker/types.ts`、`registry.ts`（`registerIntent` 預設 TTL 1800s、同 taskId 取代；`renewIntentLease`；`releaseTask`；`cleanupStaleWithEvidence`；`loadRegistry` CAS retry）、registry 檔 `.atm/runtime/write-broker.registry.json`。CLI：`node atm.mjs broker register|heartbeat|decision|status|release|acknowledge|cleanup`（`packages/cli/src/commands/broker/registry-actions.ts`、`parser.ts`）。
- 任意 actor：**可**。actorId 是自由字串，無 allowlist。
- overlap 共享：**否**。`calculateBrokerDecision`（`decision.ts`）對 file-only overlap 給 `needs-physical-split` → lane `deterministic-composer`；CLI 端 `shouldQueueSharedSurface`（`shared-surface.ts` L152–164）把同檔衝突送進 file-scoped shared-surface queue；`isBrokerSafe` 只有 parallel-safe / private-only / queue-head 才 `writeAuthorized`。→ 第二個寫者**被排隊或改送 compose**，違反 D2「不等待」。
- 早期通知：**只有 pull**。freeze 記錄寫檔，`broker status` 讀；沒有 push。
- 事件 log：**否**。registry 是覆寫式 snapshot；`cleanupStaleWithEvidence` 的移除證據只在回傳值，不進 append-only log。
- 缺口：(a) share 模式；(b) WriteIntent JSON 太重（`--intent-file`、atomRefs/sharedSurfaces 必填）；(c) 事件 log；(d) lease expiry 只在 cleanup 被呼叫時才發生（沒有背景 reaper）→ expiry 事件時間 = 下一次 cleanup 時間，需在每次 claim/status 時順帶 sweep 並記錄 `expiresAt` 原值。

### 1.2 resource-overlap 偵測 — **直接重用**
- 在哪：`packages/core/src/broker/resource-overlap.ts`（`compareResourceKeys` literal/glob；`buildResourceOverlapReport`、`buildResourceOverlaps`：file、atom-id/cid、read-set、shared surface、atomRanges 的 line-range）。
- 每筆 overlap 帶左右 taskId/actorId（laneSessionId 恆 null）。
- 正好是 `CLAIM_OVERLAP` 的判定器；line-range 可給 W4b。

### 1.3 freeze / ack / deadline — **可重用語意**
- 在哪：`packages/core/src/broker/freeze.ts`（`DEFAULT_FREEZE_ACK_TIMEOUT_MS`=30s；pending / acknowledged / timed-out / force-released / resumed / blocked-fallback；`resolveFreezeDecision` 逾時 force-release）；CLI `broker acknowledge --task --actor --freeze-id`（只有被通知的 queue head 能 ack）。
- 但它是「凍結別人」的語意（serial 化），D2 要的是「通知、不凍結」。可借用 ack/deadline 資料結構，不借用凍結行為。

### 1.4 live-write steward（`broker steward apply-live`）— **steward merge 主路徑，可重用**
- 做什麼：每筆 patch proposal 進來就在 per-file kernel advisory lock 內「讀現況→決定→寫→git commit」。不相交且 context 對得上就直接套；改到其他 session 在 anchor 之後提交的行 → `cross-session-overlap` 拒絕，指名對方 session/proposal/commit/diff，檔案不動；`--ack-overlap <proposalIds>` 可明確覆蓋。stale base 會翻譯（#363）。
- 在哪：`packages/core/src/live-write/live-queued-write.ts`（`applyLiveQueuedWrites`）、`cross-session-overlap.ts`（anchor 存 `.atm/runtime/live-write-anchors.jsonl`）、`live-write-journal-store.ts`（`.atm/runtime/live-write-journal.jsonl`，O_APPEND）、`live-write-commit.ts`；CLI `packages/cli/src/commands/broker/steward-runtime-actions.ts`。
- 任意 actor：**可**（session identity = proposal.actorId）。
- overlap 共享：**是**（同檔不同行直接套；同行才拒絕）→ 這就是 D2 要的 share-and-steward 後半段。
- 事件 log：**部分**。拒絕寫 `.atm/runtime/live-write-queue.jsonl` 帶 `queuedAt`；anchor 帶 `recordedAt`；**journal 的 committed entry 沒有時間戳**（只有 commitSha，可從 git commit 時間補，但不精確到 apply 時刻）。
- 缺口：accept 事件無 timestamp；不檢查「這個 actor 有沒有 claim 這檔」（P1 要接在這裡）；scopeFiles 是 per-call 參數，不連 claim。

### 1.5 shared compose inbox / batch coordinator（#297 合併、`cb2524243`）
- 做什麼：跨寫者批次 compose，`git merge-file` 合法子集、atomic rename、deadline 30s、最多 8 次 retry、terminal（timeout / late-commit-after-timeout / durable-unacked / retry-exhausted…）。
- 在哪：`packages/core/src/broker/shared-compose-inbox*.ts`、`SHARED_COMPOSE_INBOX_CONTRACT.md`（數值來自封存的 HIST-v2 prereg）。
- **CLI 沒有接線**（只在 core index 匯出＋測試）；canonical commit 是檔案 rename 不是 git commit。
- 對 v3：ack/deadline 的「time-to-ack」語意最完整，但要用得接 CLI，且與 apply-live 二擇一；建議 v3 用 apply-live，batch inbox 留作比較臂或不用。

### 1.6 `atm next --claim`（task-ledger claim）
- 在哪：`packages/cli/src/commands/next.ts`、`next/claim-admission.ts`、`next/claim-conflict-log.ts`、`next/claim-parallel-preflight.ts`。
- broker-authoritative；verdict `watch` 也可 admit（同 atom overlap 只給 advisory）—方向接近 D2。
- 但綁 task ledger（要先 import TASK-xxx），claim 單位是 task 不是 file；`claim-conflict-log` 是單次 decision log 物件，不是持續 append 的事件流。對「任意 Codex agent 宣告檔案」太重，不建議當入口。

### 1.7 `quickfix claim` — 不適用
- `packages/cli/src/commands/quickfix.ts`＋`work-channels.ts`（`writeQuickfixLock`）。單一全域檔 `.atm/runtime/quickfix-lock.json`，**後寫者直接覆寫前者**，無 overlap 檢查、無 TTL；3 檔/80 行上限。N 個 agent 會互相蓋掉。

### 1.8 `framework-mode claim`（temp claim）— 不適用為 claim 層，但會擋 commit
- `closure-packet-schema/implementation.ts`（`runFrameworkTempClaim` / `Release`）＋`plugin-governance-local/src/stores.ts` `lockStore.acquireLock`：鎖 id = `ATM-FRAMEWORK-TEMP-<actor>[-lane]`，記錄 files、TTL 1800s；**不做跨 actor 檔案 overlap 檢查**（只擋同 workItemId 不同 actor）。
- 關聯：`framework-commit-claim-guard.ts` 規定 taskless framework commit 必須有 live temp claim → 若實驗 repo 被判為 framework repo，每個 Codex agent commit 前都得先 framework-mode claim。

### 1.9 git lease（`git-governance/implementation/lease-command.ts` `runGitLease`）— 不適用
- 單次性 git-index override lease（stage/destructive override＋人類 phrase），與檔案 claim 無關。

### 1.10 actor / 身分
- `actor-registry.ts` `resolveActorId`：`--actor` → `ATM_ACTOR_ID` → repo default（`.atm/runtime/identity/default.json`）→ `AGENT_IDENTITY`；自由字串，無 allowlist。registry 在 `.atm/catalog/registry/actors.json`（`atm actor register|adopt|list|resolve`）。
- `identity-check-command.ts`：governed git 動作 `requireExplicitGitActor`（repo default 不算，丟 `ATM_ACTOR_ID_EXPLICIT_REQUIRED`）；git user.name/email 要與 actor profile 相符；`detectCrossTaskMutation`。
- → 每個 Codex session 要有自己的 `ATM_ACTOR_ID`＋actor registry profile（或 git identity 一致）。

### 1.11 cross-task-mutation-guard — **會跟 D2 打架**
- `packages/core/src/broker/cross-task-mutation-guard.ts`（`detectCrossTaskMutation`）：commit 觸及另一個 active task scope 的檔 → 擋。share 模式下兩個 agent 合法共享同檔，這個 guard 會誤擋。需在 ATM arm 改走 apply-live（steward 代 commit）或在 share 模式下降級為事件。

### 1.12 telemetry
- `packages/core/src/telemetry/index.ts`：append 式 `<lane>.jsonl` gate-check event（帶 actorId、laneSessionId、correlationId、durationMs）。可借用寫法當事件 sink 範本，schema 不合用。

## 2. 3–5 個關鍵發現

1. **偵測與 lease 現成，政策相反**：resource-overlap＋registry lease/heartbeat/release 都能用、任意 actorId 可用；但 broker 對同檔 overlap 的既有政策是 queue / compose / block（`shouldQueueSharedSurface`、`isBrokerSafe`），與 D2「共享、不等待、不縮範圍」相反 → 必須新增 share 模式，不能 as-is。
2. **steward merge 已經是 D2 形狀**：`broker steward apply-live`（#360/#363/#364）同檔不同行直接套、同行以 `cross-session-overlap` 拒絕並指名對方、`--ack-overlap` 明確覆蓋 → 「writes go through steward merge」可直接用，P2/P3 判定點就在這。
3. **沒有統一、帶時間戳的 append-only 事件 log**：registry 是覆寫 snapshot；cleanup 證據不落地；live-write journal 的 accept 沒時間戳；只有 reject（queuedAt）與 anchor（recordedAt）有時間。P0–P4 需要的 log 要新寫（單一 `.atm/runtime/claim-events.jsonl`，O_APPEND，monotonic+ISO 時間）。
4. **通知只有 pull**：holder 不會被推播；且 lease expiry 只在 cleanup 被呼叫時發生。要嘛把 pending overlap 注入該 actor 下一個 atm 指令輸出（不出現「其他 agent」字眼），要嘛 hook。
5. **兩個既有 guard 會誤傷 ATM arm**：cross-task-mutation-guard（共享檔 commit 被擋）與 framework temp-claim commit guard（若判定為 framework repo）；quickfix lock 是全域單檔會互蓋。ATM arm 的 commit 應統一走 steward，或在 share 模式下降級。

## 3. 建議實作輪廓（extend）

- `atm claim --files a,b [--ttl 900] --actor $ATM_ACTOR_ID`：內部產生最小 WriteIntent（atomRefs/sharedSurfaces 空）呼叫 registry；`policy=share` 時 overlap 不進 queue，回 `ok:true, writeAuthorized:true, code: CLAIM_OVERLAP, overlaps:[{file, sinceAt}]`（不帶對方 actor 名稱以免洩漏 agent 存在 → 見決策 Q3）。
- holder 端：registry 上標 `pendingOverlapNotices`，下一次該 actor 任何 atm 指令（claim/renew/apply-live/status）輸出附帶並記 `overlap-notice-delivered` 事件＋ack。
- apply-live 入口：檔案不在該 actor 有效 claim 內 → 照寫（或依決策），記 `unclaimed-write`（P1）。
- 事件：`claim-granted / claim-overlap / overlap-notice-delivered / overlap-ack / lease-renewed / lease-released / lease-expired / steward-accepted / steward-rejected(cross-session-overlap|stale-base…) / unclaimed-write`，每筆 `{seq, at(ISO), monoNs, actorId, files, claimId, relatedClaimIds}`。

## 4. 待 文一 決策（多選，附建議）

**Q1 overlap 通知怎麼送到 holder？**
- A. piggyback 在 holder 下一個 atm 指令輸出（pull，延遲 = 下一次指令間隔）**← 建議**（不需改 Codex、可記 delivered 時間）
- B. Codex hook / 檔案 watcher 推播（較即時，但每個 agent 環境都要裝，threat to validity 多）
- C. 只通知後來者，不通知 holder（偏離 D1「告知雙方」）

**Q2 share 模式放哪？**
- A. broker 內加 `policy: share` 旗標（改 decision / registry-actions 分支）
- B. 獨立薄 claim 層，只借 registry 存取＋resource-overlap，不碰 broker 決策 **← 建議**（不影響既有 HIST/v2 broker 行為與封存 prereg）
- C. 改 broker 預設行為（不建議）

**Q3 `CLAIM_OVERLAP` 回給 agent 的內容？**
- A. 只給檔案＋「此檔有其他進行中的修改，寫入會經 steward 合併」，不給 actor 名 **← 建議**（符合「不告訴 agent 有其他 agent」的最小揭露）
- B. 給對方 actor id／claim id
- C. 只回 code 不給說明

**Q4 actor 身分**
- A. 每個 Codex session 一個 `ATM_ACTOR_ID`＋actor registry profile（含 git identity）**← 建議**
- B. 共用 repo default identity（會被 `ATM_ACTOR_ID_EXPLICIT_REQUIRED` 擋，且無法區分 P0 雙方）

**Q5 commit 路徑與既有 guard**
- A. ATM arm 所有寫入走 `broker steward apply-live`（steward 代 commit），agent 不直接 git commit **← 建議**（cross-task-mutation-guard 不介入、P2/P3 判定集中）
- B. agent 自行 commit，share 模式下把 cross-task-mutation-guard 降級為事件
- C. 維持 guard 原樣（會誤擋共享檔，違反 D2）

**Q6 lease TTL**
- A. 900s＋每次 atm 指令自動 renew，release on commit **← 建議**
- B. 沿用 registry 預設 1800s
- C. 不設 TTL，只在 commit/結束時 release

**Q7 未 claim 檔第一次寫入（P1）**
- A. 允許寫入並記 `unclaimed-write`＋自動補 claim **← 建議**（量測不干預）
- B. 拒絕寫入要求先 claim（會改變 agent 行為，混入 P1 定義）
