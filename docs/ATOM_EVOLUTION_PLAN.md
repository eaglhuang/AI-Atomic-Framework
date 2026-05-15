# Atom 證據驅動進化規劃書

Status: In progress
Date: 2026-05-15
Audience: ATM core maintainers, plugin authors, host adapter authors
Target repo: AI-Atomic-Framework

## 0. 摘要

ATM 已具備 Atom lifecycle、Evidence、ContextSummary、UpgradeProposal、ReviewAdvisory、HumanReviewDecision、behavior taxonomy、registry status transition、mutability policy 與 validator scripts。現在缺的不是第二套治理系統，而是一條嚴謹路徑：讓使用過程中的經驗穩定回流成可審查、可回滾、可治理的 Atom 或 Atom Map 進化提案。

本規劃書定義「Atom 證據驅動進化」：

- 使用過程中的修正、失敗、成功路徑與回歸訊號，先被記錄為 Evidence。
- Evidence 經 deterministic detector 聚合後，才允許草擬 UpgradeProposal。
- Detector 與 reviewer 只能產生 UpgradeProposal 草案，不得直接修改 registry。
- Proposal 必須宣告 `proposalSource`、`targetSurface`、版本基準、evidence watermark 與 reversibility。
- 真正升級仍由 JSON Schema validation、ReviewAdvisory、HumanReviewDecision、automated gates 與 registry transitions 決定。
- Atom Map 的進化由 caller graph、input/output overlap、evidence cluster 與 downstream impact 推導。

核心原則：Evidence 只能說明「為什麼值得考慮進化」，治理閘門才決定「是否允許進化」。

## 1. 現況基礎

### 1.1 已存在契約

- `packages/core/src/index.ts` 已定義 `EvidenceRecord` 與 `ContextSummaryRecord`。
- `schemas/upgrade/upgrade-proposal.schema.json` 已定義 `atm.upgradeProposal`，包含 `behaviorId`、`automatedGates`、`humanReview`、`status`、`inputs`。
- `packages/plugin-sdk/src/lifecycle.ts` 已定義 `QualityMetricsSnapshot`、`QualityMetricsComparator`、`UpgradeProposalAdapter` 等 advisory 介面。
- `packages/plugin-sdk/src/behavior-registry.ts` 已強制 `behavior.evolve` 必須 delegate 到 `ProposeAtomicUpgrade`，避免 silent mutation。
- `packages/core/src/registry/status-machine.ts` 已定義 registry transition 與 mutability policy。
- `package.json` 已提供 `validate:schemas`、`validate:upgrade-proposal`、`validate:review-advisory`、`validate:human-review`、`validate:behavior-sdk`、`validate:behavior-pack`、`validate:status-machine`、`validate:standard` 等驗證入口。

### 1.2 仍待新增 runtime

- Evidence signal classifier。
- Persistent Atom usage telemetry。
- 將 evidence cluster 與 context summary 轉成 UpgradeProposal draft 的橋接器。
- Atom Map curator detector。
- Stale proposal gate。
- Host-local preference 不得直接升級為 global atom-spec 的 downgrade rule。

## 2. 設計原則

1. 不直接突變 registry：經驗回流只能產生 proposal。
2. 不只靠使用次數觸發：draft 必須同時具備 usage threshold 與 friction evidence。
3. 不把單一使用者偏好預設升級為全域 Atom 規則。
4. 不建立平行治理線：沿用 UpgradeProposal、ReviewAdvisory、HumanReviewDecision 與 registry transitions。
5. Schema change 先採 optional additive strategy，除非後續 migration 明確升級成 required。
6. 所有進化提案都必須可追溯到 evidence 或 reproducible artifacts。
7. Promotion 前必須檢查 base version 與 evidence watermark。
8. Atom 與 Atom Map 分流：單一 Atom 行為走 `behavior.evolve`；結構重組走 `behavior.compose`、`behavior.merge`、`behavior.dedup-merge`、`behavior.sweep`。

## 3. 核心資料模型擴充

### 3.1 EvidenceRecord 新增欄位

`EvidenceRecord` 新增 optional 欄位來承載進化訊號：

- `signalKind`：觀測到的訊號類型。
- `signalScope`：訊號適用於 host-local preference、repo workflow、Atom、Atom Map 或 global contract。
- `atomId`：可選的目標 Atom ID。
- `atomMapId`：可選的目標 Atom Map ID。
- `patternTags`：供 detector 聚合重複模式的 tags。
- `confidence`：detector 信心值，範圍 0 到 1。
- `recurrence`：觀測 window、count、firstSeenAt、lastSeenAt。

初期 rollout 期間，這些欄位都必須保持 optional，確保既有 Evidence producer 不需要同步改寫。

### 3.2 UpgradeProposal 新增欄位

`atm.upgradeProposal` 新增 optional metadata：

- `proposalSource`：`evidence-driven`、`metric-driven`、`manual` 或 `spec-diff`。
- `targetSurface`：`host-local-overlay`、`workflow-recipe`、`atom-spec` 或 `atom-map`。
- `baseAtomVersion`：新提案若 target `atom-spec`，必須提供。
- `baseMapVersion`：新提案若 target `atom-map`，必須提供。
- `baseEvidenceWatermark`：用於偵測 stale draft 的 evidence stream position。
- `reversibility`：`rollback-safe` 或 `breaking`。
- `evidenceGate`：required signal kinds、matched evidence IDs、rejected evidence IDs 與 gate notes。

既有 upgrade proposal fixtures 不需要補這些欄位；新的 evidence-driven fixtures 必須覆蓋這些欄位。

## 4. 觸發規則

### 4.1 雙條件觸發

Atom proposal draft 只有在以下條件同時成立時才能產生：

- `usageCount(atomId, window) >= N`
- `frictionEvidence(atomId, window) >= M`

建議初始預設值為 `N = 10`、`M = 1`。早期 rollout 應預設 dry-run，只產報告，不直接送入 review queue。

### 4.2 抑制規則

- Window 內只有 positive 或 neutral evidence 時，不產 proposal。
- Host-local 格式偏好不得自動升級為 `atom-spec`。
- Detector confidence 低於門檻時，只產 observation report，不進 proposal queue。
- 每個 Atom 設定每日 proposal cap。
- 若 draft 產生後 target version 已變更，promotion 必須 blocked，並在 review output 標示 stale condition。

### 4.3 持久化要求

Usage count 與 recurrence state 不得只存在暫態 agent state。它們必須表示在 Evidence、governance bundle、run report 或 registry-side telemetry 中，讓短 session 與跨 session 工作仍能累積訊號。

## 5. Reviewer Bridge

### 5.1 職責

Reviewer Bridge 是後續要新增的 runtime component，負責把 evidence cluster 與 context summary 轉成 UpgradeProposal draft。

### 5.2 權限模型

允許讀取：

- Evidence lists。
- Context summary lists。
- Atom spec reads。
- Atom Map reads。
- Registry status reads。

允許寫入：

- UpgradeProposal drafts。
- Observation reports。

禁止操作：

- 直接編輯 registry。
- 直接 promote。
- 直接修改 Atom spec。
- 直接修改 Atom Map。
- 產生沒有 evidence references 的 proposal draft。

### 5.3 草案輸出要求

每個 proposal draft 必須包含：

- `proposalSource`。
- `targetSurface`。
- Evidence input references。
- 適用時提供 `baseAtomVersion` 或 `baseMapVersion`。
- `baseEvidenceWatermark`。
- `reversibility`。
- Rollback plan 或 rollback-proof requirement。

## 6. Atom Map Curator

Atom Map curator 是後續要新增的 detector。它應以結構與證據為主，不以文字相似度作為主要判斷依據。

訊號來源：

- 多個 Atoms 的 input/output schema overlap。
- 跨 work items 反覆出現的 caller graph sequence。
- 共享 recurring failure pattern。
- 共享 downstream consumers。
- 長期 zero-caller 且沒有 positive evidence 的 Atoms。

可產生的 proposal：

- `behavior.compose`：將反覆出現的 Atom sequence 提升為 Atom Map。
- `behavior.merge`：合併高度重疊的 Atoms。
- `behavior.dedup-merge`：移除重複能力面。
- `behavior.sweep`：封存未使用 Atoms，不刪除。

所有 curator output 都仍是 UpgradeProposal，必須通過與其他 proposal 相同的 gates。

## 7. Promotion Gates

### 7.1 Stale Proposal Gate

Promotion 前，review layer 必須確認：

- Proposal target 是 Atom 時，current Atom version 等於 `baseAtomVersion`。
- Proposal target 是 Atom Map 時，current map version 等於 `baseMapVersion`。
- Evidence watermark 沒有被更高優先級的人類決策覆蓋。
- Target mutability policy 允許 requested transition。

任何檢查失敗時，proposal 必須 blocked，review output 必須說明 stale condition。

### 7.2 Target Surface Downgrade Gate

當 proposal 只引用單一使用者或單一 session 的 preference evidence：

- `atom-spec` target 自動降級為 `host-local-overlay`。
- `atom-map` target 轉為 observation report，除非 reviewer 明確核可更大 scope。

### 7.3 Privacy Gate

Evidence 進入 Reviewer Bridge 前必須支援 redaction policy：

- 移除 secrets、tokens、credentials。
- 依 host policy 處理姓名、email、路徑與其他可識別內容。
- 若曾考量敏感 input，必須把 redaction report 附為 proposal input。

## 8. 里程碑與 Checklist

### M0 - 規劃書定稿

目的：發布本規劃書，並移除舊提案中對外部架構假設的依賴。

交付物：

- `docs/ATOM_EVOLUTION_PLAN.md`。
- `docs/LIFECYCLE.md` 加入 evidence-driven evolution 短說明。
- `docs/ARCHITECTURE.md` 加入短說明，確認此流程不建立第二套 registry。

Checklist：

- [x] 文件只使用 ATM 術語。
- [x] 文件明確區分已存在 contract 與未來 runtime component。
- [x] 文件包含里程碑、驗證命令、風險與回滾策略。
- [x] 文件通過 documentation review。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:guide`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:guidance`
- Review 前搜尋本文件與相關 edits，確認未出現禁止的外部專案字詞。

### M1 - Schema Additive Expansion

目的：讓 Evidence 與 UpgradeProposal 能承載進化訊號與 target surface。

交付物：

- `packages/core/src/index.ts` 新增 optional evidence signal fields。
- `schemas/governance/evidence.schema.json` 與 embedded evidence schema definitions 新增 optional evidence signal fields。
- `schemas/upgrade/upgrade-proposal.schema.json` 新增 optional proposal metadata fields。
- `fixtures/upgrade/evidence-driven-proposal.json`。
- `fixtures/upgrade/stale-proposal.json`。

Checklist：

- [x] EvidenceRecord 新增欄位都是 optional。
- [x] UpgradeProposal 新增欄位不破壞既有 fixtures。
- [x] 新 proposal fixtures 覆蓋 `proposalSource`、`targetSurface`、base version、evidence watermark 與 `reversibility`。
- [x] TypeScript 與 JSON Schema 保持同步。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run typecheck`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:schemas`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:type-schema-sync`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:upgrade-proposal`

M0 與 M1 已於 2026-05-15 完成並提交。

### M2 - Evidence Pattern Detector

目的：新增 deterministic detector，從 EvidenceRecord 聚合 friction signals，不呼叫模型、不寫 registry。

交付物：

- 適合 SDK 或 plugin package 的 detector module。
- `fixtures/evolution/evidence-patterns/*.json`。
- Detector report schema。
- `npm run validate:evidence-detector` 驗證入口。

Checklist：

- [x] 支援 `signalKind` grouping。
- [x] 支援 recurrence windows。
- [x] 支援 confidence thresholds。
- [x] 支援 `atomId` 與 `atomMapId` grouping。
- [x] 訊號不足時輸出 empty report。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run typecheck`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run test`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:plugin-sdk`

### M3 - Proposal Draft Bridge

目的：新增 dry-run bridge，將 detector reports 轉成 schema-valid UpgradeProposal drafts。

交付物：

- `atm evolve scan` 或等價 CLI entry。
- Proposal drafter adapter。
- Dry-run mode。
- Observation report output。

Checklist：

- [x] CLI 預設 dry-run。
- [x] 缺少 evidence IDs 時不產 proposal。
- [x] 缺少 friction evidence 時不產 proposal。
- [x] Proposal draft 包含 `targetSurface`。
- [x] Draft 只進 queue 或 output path，不 promote。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:cli`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:upgrade-proposal`
- No-signal fixture 輸出 empty report。
- Correction fixture 輸出 evidence-driven proposal。

### M4 - Promotion Safety Gates

目的：新增 stale、downgrade、privacy 與 reversibility gates。

交付物：

- ReviewAdvisory rule extensions。
- Stale proposal fixture。
- Single-user preference downgrade fixture。
- Redaction report fixture。

Checklist：

- [x] `baseAtomVersion` mismatch 會 block promotion。
- [x] `baseEvidenceWatermark` stale condition 會 block promotion。
- [x] Single-user preference 不會自動 promote 到 `atom-spec`。
- [x] Breaking proposals 必須 human review。
- [x] 若 proposal 考量過 sensitive inputs，缺 redaction report 時必須 blocked。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:review-advisory`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:human-review`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:governance-commands`

M4 已於 2026-05-15 完成並提交。

### M5 - Atom Map Curator Detector

目的：從 graph 與 evidence 結構提出 Atom Map 進化 proposal。

交付物：

- Caller graph fixture。
- Input/output overlap fixture。
- Recurring failure cluster fixture。
- `behavior.compose` proposal fixture。
- `behavior.merge`、`behavior.dedup-merge`、`behavior.sweep` proposal fixtures。

Checklist：

- [x] Compose proposal 列出 members。
- [x] Merge proposal 列出 source Atoms 與 target Atom。
- [x] Sweep proposal 只封存，不刪除。
- [x] Immutable targets 不可 auto-promote。
- [x] Generated proposals 引用 evidence inputs。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:map-curator`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:behavior-sdk`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:behavior-pack`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:status-machine`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:registry-core`

M5 已於 2026-05-15 完成並提交。

### M6 - Metric-Driven Track

目的：讓 objective capability upgrades 仍由 metrics 與 gates 治理。

交付物：

- `proposalSource: metric-driven` fixture。
- QualityMetricsComparison to proposal adapter。
- Regression comparison report fixture。

Checklist：

- [x] Metric regression 可產 proposal。
- [x] Metric improvement 可成為 promotion evidence。
- [x] Holdout 或 regression failure 會 block promotion。
- [x] Metric-driven 與 evidence-driven proposals 共用後段 gates。

M6 已於 2026-05-15 完成並提交。新增 `fixtures/upgrade/metric-driven-proposal.json`、`fixtures/upgrade/metric-regression-blocked-proposal.json`、`packages/core/src/upgrade/metrics-to-proposal.ts`；`validate-upgrade-proposal` 延伸驗證 metric-driven track。Metric-driven proposals 需與 evidence-driven proposals 共用後段 stale gate，並提供 `baseEvidenceWatermark`。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:regression-compare`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:upgrade-proposal`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:standard`

### M7 - End-to-End Example

目的：驗證 evidence -> proposal -> review -> human decision -> registry transition 的完整流程。

交付物：

- `examples/atom-evolution-loop/`。
- Demo governance bundle。
- Demo fixtures。
- README walkthrough。

Checklist：

- [x] Demo 可在五分鐘內跑完。
- [x] Demo 至少產生一個 `atom-spec` proposal。
- [x] Demo 至少產生一個 `atom-map` proposal。
- [x] Demo 包含 rejected proposal case。
- [x] Demo 包含 stale proposal case。

M7 已於 2026-05-15 完成並提交。新增 `examples/atom-evolution-loop/`（含 atom spec、src、test、governance bundle 四種 demo proposal、README）；`validate-examples` 涵蓋第三個範例。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:examples`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:governance-local`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:standard`

### M8 - Rollout Metrics

目的：量測進化 proposal 是否改善維護效率，同時避免 review flooding。

交付物：

- Proposal precision report。
- False-positive review report。
- Promotion latency report。
- Rollback rate report。
- Host 提供 usage data 時，補 cost 或 budget report。

Checklist：

- [x] Proposal acceptance rate 可量測。
- [x] Blocked reasons 可分類。
- [x] Stale rate 可量測。
- [x] Curator merge accuracy 可由 human review 抽查。
- [x] Daily proposal cap 可配置。

M8 已於 2026-05-15 完成並提交。新增 `schemas/governance/rollout-metrics-report.schema.json`、`fixtures/rollout-metrics/sample-rollout-metrics.json`、`scripts/validate-rollout-metrics.ts`；`validate:rollout-metrics` 已加入 standard suite（31/31 通過）。

驗證：

- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:multi-agent-confidence`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:governance-commands`
- `npm --prefix C:\Users\User\AI-Atomic-Framework run validate:standard`

## 9. 風險與緩解

| Risk | Mitigation |
|---|---|
| Proposal noise 過高。 | 雙條件觸發、confidence threshold、daily cap、dry-run rollout。 |
| 單一使用者偏好污染 global Atom behavior。 | Target surface downgrade gate。 |
| Stale proposal 覆蓋較新的狀態。 | Base version 與 evidence watermark checks。 |
| Sensitive data 進入 proposal。 | Redaction policy 與 redaction report gate。 |
| Curator 錯誤合併 Atoms。 | Compose 與 merge outputs 都只是 proposal，必須 review。 |
| Additive schema fields 破壞 adapter 假設。 | Optional fields、backward-compatible fixtures、type-schema sync validation。 |
| Runtime cost 過高。 | Scan windows、daily caps、dry-run mode、host scheduling。 |

## 10. 非目標

- 不建立第二套 registry。
- 不建立第二套 approval workflow。
- 不直接寫入 Atom specs。
- 不自動把 host-local preferences promote 成 global rules。
- 不要求特定模型、database 或 optimizer。
- Safety gates 完成前，不啟用 automatic promotion。

## 11. 完成定義

本計畫完成時，ATM 應能證明：

- Evidence 可以標記 evolution signals。
- UpgradeProposal 可以宣告 source、target surface、version baseline、evidence watermark 與 reversibility。
- Detector 可以從 evidence clusters 找出值得提案的 friction patterns。
- Draft bridge 可以產生 schema-valid proposals，且不能寫 registry。
- Review gates 可以阻擋 stale proposals、sensitive data leaks、single-user preference pollution 與 breaking proposals。
- Atom Map curator 可以從 graph 與 evidence structure 提出 compose、merge、sweep 變更。
- End-to-end example 可以驗證完整流程。

## 12. 建議實作順序

1. 先落地 M0 文件與術語。
2. 實作 M1 schema additive expansion。
3. 實作 M2 detector，採 fixture-first tests。
4. 實作 M3 dry-run draft bridge。
5. M4 gates 完成前，不允許 automatic promotion。
6. M5 再加入 Atom Map curator behavior。
7. 保留 M6 metric-driven track，確保 objective capability upgrades 仍依賴 metrics。
8. 用 M7 與 M8 判斷是否值得開啟更多自動化。