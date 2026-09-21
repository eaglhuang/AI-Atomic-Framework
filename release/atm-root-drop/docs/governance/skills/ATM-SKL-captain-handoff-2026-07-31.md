# ATM SKL / Plan 3.x / Plan 4.0 Captain Handoff — 2026-07-31

交接對象：下一任 ATM 總隊長  
交接者：codex-skl-captain  
交接目的：本對話 token 接近上限，停止開新卡，讓下一個對話能安全接手。

## 0. 總隊長判斷

不要把目前狀態理解成「Plan 3.x 全部已完全驗證，所以可以無條件跳到 Plan 4.0」。

比較準確的狀態是：

- Plan 3.0 / 3.1 的多數核心能力與任務卡已在 ledger 上 close。
- 但 Plan 3.0 / 3.1 的真實 dogfood、dashboard / telemetry / performance evidence 曾經多次被 backlog 明確標記為「仍需要 fresh sealed evidence」或「 final verdict 要消化後續缺陷」。
- Plan 3.2 已補了一批 Plan 3.1 外層 adapter / close / validation / import fidelity 的缺口。
- Plan 4.0 已開始做「測試覆蓋率與自我驗證系統」的底層模型，但尚未完成 QualityGauntlet、causal neighborhood、selective regression routing 與 skill projection。

下一任隊長的第一性原理判斷：

ATM 不能只看任務卡 `done`。如果「度量儀表 / replay dashboard / sealed evidence」沒有被重新驗證，就只能說核心能力已落地，不能說產品級真並行與測試覆蓋證明已完全放行。

## 1. Plan 3.0 狀態

### 已完成

Ledger 顯示以下 Plan 3.0 關鍵任務已 done：

| Task | 狀態 | 摘要 |
| --- | --- | --- |
| ATM-GOV-0230 | done | Runner sync stale reservation lifecycle |
| ATM-GOV-0231 | done | Generalized command manifest and recovery emission |
| ATM-GOV-0232 | done | Task import parser and recovery boundary reconciliation |
| ATM-GOV-0233 | done | Transactional ticket completion and legacy BCR migration |
| ATM-GOV-0234 | done | Real multiprocess parallel replay and telemetry proof |
| ATM-GOV-0235 | done | ATM 3.0 final closure and circuit breaker verdict |
| ATM-GOV-0236 | done | Plan 3.0 shared governance state readiness gate |

### 需要重新驗證 / 不可跳過的疑點

Plan 3.0 的 closure 在 ledger 上是 done，但 `docs/governance/atm-3-replay-evidence.md` 與 backlog 曾留下明確警語：

- Plan 3.0 仍需要 fresh `0234/0235` sealed dogfood / performance evidence，才能宣稱 final closure 品質足夠。
- 曾有 batch checkpoint、runner-sync、shared-surface recovery deadlock 相關 bug。
- 曾有 full-plan prompt routing 選回已完成 queue head 的問題。

下一任隊長應把 Plan 3.0 視為：

- 功能任務：已完成。
- 儀表數據 / sealed replay / performance evidence：需要 audit refresh。
- 產品放行信心：不能只靠舊 done 狀態，要重新跑或確認 dashboard evidence 是否 fresh。

## 2. Plan 3.1 狀態

### 已完成

Ledger 顯示 Plan 3.1 主要任務已 done：

| Task | 狀態 | 摘要 |
| --- | --- | --- |
| ATM-GOV-0237 | done | Plan 3 real dogfood shared replay surface A |
| ATM-GOV-0238 | done | Plan 3 real dogfood shared replay surface B |
| ATM-GOV-0239 | done | Fail-closed closure truth and authority reconciliation |
| ATM-GOV-0240 | done | Historical runner red-green discrimination harness |
| ATM-GOV-0241 | done | Event-derived replay lifecycle receipt contract |
| ATM-GOV-0242 | done | Real two-card compose-first and fallback dogfood orchestrator |
| ATM-GOV-0243 | done | Matched AB BA governed workload benchmark |
| ATM-GOV-0244 | done | Backlog rollback parity and circuit-breaker closeback |
| ATM-GOV-0245 | done | Plan 3.1 evidence aggregator and final verdict |
| ATM-GOV-0246 | done | Dual-captain dogfood dashboard and sealed run manifest |
| ATM-GOV-0247 | done | Single canonical worktree compose-first invariant and Git topology boundary |
| ATM-GOV-0248 | done | Non-Git proposal workspace provider and steward write-path migration |
| ATM-GOV-0249 | done | Transactional compose output and single-write steward apply |
| ATM-GOV-0250 | done | Receipt-bound shared-write admission and steward-only delivery |
| ATM-GOV-0251 | done | Acceptance evidence predicates and realness taxonomy |
| ATM-GOV-0252 | done | Independent acceptance closure gate and two-key verifier |
| ATM-GOV-0253 | done | Cross-authority two-phase closeback saga |
| ATM-GOV-0254 | done | Transactional patch materialization and post-compose semantic validation |
| ATM-GOV-0255 | done | Broker resolution authority parity and claim-admission proof |
| ATM-GOV-0256 | done | Runner-sync source snapshot and cache-hit freshness gate |
| ATM-GOV-0257 | done | Actor identity continuity across captain and shared-write lanes |
| ATM-GOV-0258 | done | Broker-managed transactional stage commit queue |
| ATM-GOV-0259 | done | Write-ticket scope amendment guard and out-of-scope WIP recorder |
| ATM-GOV-0260 | done | Staged candidate line-budget and nested commit recovery |
| ATM-GOV-0261 | done | VCS-neutral commit candidate isolation and Git adapter fallback |
| ATM-GOV-0262 | done | Canonical overlap matcher call-site parity |
| ATM-GOV-0263 | done | Autonomous continuation and executable recovery parity |
| ATM-GOV-0264 | done | Canonical Broker Admission Facade and same-atom bounded proposal routing |
| ATM-GOV-0265 | done | Shared mutation finalization and sealed runner publication |
| ATM-GOV-0266 | done | Runner-sync sealed-input continuity and durable steward finalization |
| ATM-GOV-0267 | done | Runner version selection qualification and feedback loop |
| ATM-GOV-0268 | done | Runner selection producer contract and snapshot provider |

### 需要重新驗證 / 不可跳過的疑點

Plan 3.1 特別要小心：任務卡 done 不等於「真雙隊長重疊範圍已產品級放行」。

已知曾暴露過的缺陷家族：

- broker resolution authority envelope 與 claim retry 不一致。
- runner-sync cache-hit freshness / sealed-source continuity。
- actor identity continuity across captain / shared-write lanes。
- commit queue / shared Git index isolation。
- tasks release 留下 ownerless dirty WIP。
- next / statusCommand 曾吐出不可直接執行或已完成任務路由。
- capability / ticket / lease secrecy 與隊長代理權限邊界。
- dashboard / dogfood evidence 是否 fresh、是否代表真實並行，而不是 replay / fixture。

下一任隊長應將 Plan 3.1 視為：

- 核心 broker / steward / claim / commit 能力：已大量修復並 close。
- 儀表數據與 dashboard：需要重新確認 fresh sealed evidence，尤其 `ATM-GOV-0246` dashboard 與 `ATM-GOV-0245` final verdict 是否消化了後續 0255-0268 的修復。
- 真並行放行：只能在 Plan 3.2 blocking adapters 與 Plan4 testing evidence 補齊後再做新的現場驗證。

## 3. Plan 3.2 狀態

### 已完成

Ledger 顯示以下 Plan 3.2 / Plan 3.1 completion boundary 補強卡已 done：

| Task | 狀態 | 摘要 |
| --- | --- | --- |
| ATM-GOV-0269 | done | Validation plan observability and resumable standard gate |
| ATM-GOV-0270 | done | Evidence freshness engine for incremental close validation |
| ATM-GOV-0271 | done | Governance close saga legal recovery coordinator |
| ATM-GOV-0272 | done | Public forward and emergency attestation authority |
| ATM-GOV-0273 | done | Target planning and runner closeback boundary split |
| ATM-GOV-0274 | done | Enforce same-task different-lane claim rejection |
| ATM-GOV-0275 | done | Preserve foreign work during dual-captain governed commit |
| ATM-GOV-0276 | done | Planning seal benign upgrade and task import fidelity guard |

### 目前判斷

Plan 3.2 的重點不是直接測真並行，而是補足 Plan 3.1 「核心做強後，外層 adapter 還沒完全收斂」的 blocking capability。

目前可暫判：

- 0274 / 0275 / 0276 已把「不能錯放行 claim」、「commit 不污染 foreign work」、「import / seal fidelity」這三個大洞補上。
- 但真雙隊長重疊範圍測試仍不應只靠人工信心，要接 Plan4 的 coverage / obligation / gauntlet 證明。

### 未完成或待 audit

- 0269 曾因 import-before-commit / planning seal drift / causalGraph fidelity 問題卡住；0276 已修同源能力，但下一任隊長仍應確認 0269 的現場 residue 是否完全清掉。
- 3KLife 目前仍有 0269 相關 dirty residue：
  - `.atm/catalog/registry/actors.json`
  - `.atm/runtime/identity/default.json`
  - `docs/ai_atomic_framework/governance-optimization/tasks/ATM-GOV-0269-validation-plan-observability-and-resumable-standard-gate.task.md`
  - `.atm/history/task-events/ATM-GOV-0269/`

## 4. Plan 4.0 狀態

### 已完成

| Task | 狀態 | 摘要 |
| --- | --- | --- |
| ATM-GOV-0277 | done | Model-relative coverage semantics and quality certificate vocabulary |
| ATM-GOV-0279 | done | Obligation inventory schema and inventory drift detector |
| ATM-GOV-0280 | done | CoverageUniverseCompiler interface reachability and canonical obligation IDs |

本輪完成並推送：

- 0279：obligation inventory / drift detector。
- 0280：coverage universe compiler / canonical obligation ids / reachability status。

Framework `origin/main` 已推到：

- `74872fe04f47bf2d04f8d7cb5b48c2b3da3fc730`

3KLife `origin/master` 已推到：

- `5222c726cd9ef17cdc7069f649a2a400ef623007`

### 未完成

| Task | 狀態 | 摘要 | 依賴 |
| --- | --- | --- | --- |
| ATM-GOV-0284 | planned | QualityGauntlet facade and ClosureAssuranceMachine reducer events | 0280, 0269 |
| ATM-GOV-0285 | planned | Validator catalog selection bridge and resumable probe scheduler | 0284, 0269 |
| ATM-GOV-0293 | planned | Fault fingerprint and semantic family matching policy | 0279, 0292 |
| ATM-GOV-0294 | planned | Causal neighborhood compiler and factor combination generator | 0280, 0293 |
| ATM-GOV-0305 | planned | Cumulative regression family store and selective routing | 0285, 0293, 0294 |

### Plan 4.0 的核心方向

Plan 4.0 不是「更多測試」而已，而是要建立：

- coverage universe：ATM 知道應該被驗證的範圍。
- obligation inventory：每個 obligation 有 canonical id。
- reachability：區分 reachable / unreachable / unsupported / excluded / unknown。
- QualityGauntlet：把 obligation、validator、closure machine 串成正式品質閘。
- causal neighborhood：漏水就測漏水附近與同因排列組合；漏瓦斯不跑漏水整包。
- selective regression routing：只跑相關 failure family，降低治理成本。
- test generator / writer / reviewer 分權：Writer 不能控制自己的考卷。

## 5. SKL 家族狀態

### 已完成

| Task | 狀態 | 摘要 |
| --- | --- | --- |
| TASK-SKL-0027 | done | Replaceable deep-module refactoring provider route |
| TASK-SKL-0028 | done | Skill corpus audit and canary rewrites |
| TASK-SKL-0029 | done | Autonomous validator and review lifecycle integration |
| TASK-SKL-0030 | done | Historical A-B replay verdict and migration guide |
| TASK-SKL-0031 | done | Data-driven skill tiers and full-corpus integration profiles |
| TASK-SKL-0032 | done | Editor-global skill source federation and overlay manifests |
| TASK-SKL-0033 | done | Diagnostic feedback loop provider and causal repair receipt |
| TASK-SKL-0034 | done | Engineering change method profiles and fidelity receipts |
| TASK-SKL-0035 | done | Deep module boundary topology validator |
| TASK-SKL-0036 | done | Incident-learning intake and backlog skill contract |

### 未完成

| Task | 狀態 | 摘要 | 依賴 |
| --- | --- | --- | --- |
| TASK-SKL-0037 | planned | Plan 4.0 lifecycle skill projections and adapter parity | TASK-SKL-0036, ATM-GOV-0305 |

### 重要判斷

SKL 的 Plan4 最終入口改造尚未完成，因為 `TASK-SKL-0037` 依賴 `ATM-GOV-0305`。

換句話說：

- 目前 skills 已經有 deep-module、validator、incident-learning、backlog feedback 等基礎。
- 但 task-card / dispatch / evidence / handoff / mailbox skills 還沒全部吃到 Plan4 的 exam-authority mode。
- Owner 提出的兩種模式仍要在 SKL-0037 完成後才算全面落地：
  - 非 Team Agents：寫卡者負責 Test Generator，先封 required/advisory/phase test ids；Writer 必須不是寫卡者。
  - Team Agents：Test Generator 在 Writer 實作前審查/補足 test ids，且 Test Generator / Writer 預設必須不同 actor、不同 provider/model family。

## 6. 建議待辦順序

下一任隊長不要直接跳到大規模真並行測試。建議順序如下：

1. P0：Plan 3.0 / 3.1 dashboard 與 telemetry audit
   - 確認 `ATM-GOV-0234` / `0235` fresh sealed dogfood / performance evidence 是否真的存在且仍 fresh。
   - 確認 `ATM-GOV-0245` final verdict 是否消化 0255-0268 的後續修復。
   - 確認 `ATM-GOV-0246` dashboard / sealed run manifest 是否代表真實雙隊長而非舊 replay / fixture。

2. P0：Plan 3.2 residue audit
   - 檢查 0269 現場 residue 是否仍存在。
   - 確認 0274 / 0275 / 0276 的 regression validators 能在 frozen runner 下通過。

3. P1：繼續 Plan 4.0 核心鏈
   - `ATM-GOV-0284`
   - `ATM-GOV-0285`
   - `ATM-GOV-0293`
   - `ATM-GOV-0294`
   - `ATM-GOV-0305`

4. P1：完成 SKL 入口投影
   - `TASK-SKL-0037`
   - 將 Plan4 的 exam-authority、causal feedback、selective regression routing 寫入 task-card / dispatch / evidence / handoff / mailbox skills。

5. P2：才做新的真雙隊長重疊範圍 dogfood
   - 目標不是「證明能跑」，而是用 Plan4 evidence 證明：
     - 哪些 obligation covered。
     - 哪些 dashboard metrics fresh。
     - 哪些 failure family 被 selective regression 覆蓋。
     - 是否有 foreign WIP、index pollution、claim/commit adapter bypass。

## 7. 本輪已完成的 0279 / 0280 詳細紀錄

### ATM-GOV-0279

已完成、close、runner-sync、push。

Framework commits:

- `9e603ea3f` — `feat(evidence): add obligation inventory drift detector`
- `0cd8f129f` — `chore(taskflow): close ATM-GOV-0279 target governance bundle`
- `dc8e9d47d` — `build(release): publish ATM-GOV-0279 runner sync`
- `ce1ff487f` — `docs(backlog): add ATM-GOV-0279 runner sync evidence`

3KLife planning close commit:

- `83d9d8352e4e1f6e7142fb830fa2ac830da7856e`

驗證已通過：

- `node --strip-types tests/cli/plan4-obligation-inventory.test.ts`
- `npm run typecheck`
- `npm run validate:cli`
- `npm run validate:git-head-evidence`

### ATM-GOV-0280

已完成、close、runner-sync、push。

Framework commits:

- `d1a1f2bee` — `feat(evidence): add coverage universe compiler`
- `946e44895` — `chore(taskflow): close ATM-GOV-0280 target governance bundle`
- `74872fe04` — `build(release): publish ATM-GOV-0280 runner sync`

3KLife planning close commit:

- `5222c726cd9ef17cdc7069f649a2a400ef623007`

驗證已通過：

- `node --strip-types tests/cli/plan4-coverage-universe-compiler.test.ts`
- `npm run typecheck`
- `npm run validate:cli`
- `npm run validate:git-head-evidence`

狀態確認：

- `node atm.mjs tasks status --task ATM-GOV-0280 --json`
- live ledger：done
- claim：released
- planning mirror：done
- residue：no-residue

## 8. 緊急通道使用紀錄

0279 與 0280 的 runner-sync release artifact commit 都撞到同一類既知 ATM bug：

- 正常命令：`node atm.mjs git commit --actor ... --task ... --message "build(release): publish ... runner sync" --auto-stage --json`
- 失敗碼：`ATM_PROTECTED_STATE_EVIDENCE_FILE_MISSING_TASK_CONTEXT`
- 現象：commit adapter 只 staged `.atm/history/evidence/<task>.runner-sync-receipt.json`，沒有把 release outputs 一起納入，導致 hook 認為 receipt 缺 task context。

已依 Owner 授權使用 `atm-git-pathspec-emergency-commit` 原則做 path-bounded native commit。

此 bug 已回寫到：

- `docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-31-006.json`
- `docs/governance/atm-bug-and-optimization-backlog.md`

下一任隊長仍應先嘗試正常 ATM commit；只有重現同一 adapter bug 且沒有 governed recoveryCommand 時才使用緊急通道。

## 9. 目前工作區狀態與不要碰的 residue

Framework repo 仍有既有 foreign WIP，請勿混入下一張任務：

- `artifacts/generated/skill-corpus-audit.json`
- `.atm/history/protected-override-audit/2026-07-30*.json`
- `.atm/history/protected-override-audit/2026-07-31*.json`
- `.atm/history/task-events/TASK-SKL-0037/`
- `.atm/history/tasks/TASK-SKL-0037.json`
- `atomic_workbench/atoms/ATM-GOV-0001/atom.test.report.json`

3KLife repo 仍有前手 residue，請勿混入：

- `.atm/catalog/registry/actors.json`
- `.atm/runtime/identity/default.json`
- `docs/ai_atomic_framework/governance-optimization/tasks/ATM-GOV-0269-validation-plan-observability-and-resumable-standard-gate.task.md`
- `.atm/history/task-events/ATM-GOV-0269/`

## 10. 下一任隊長起手命令

新對話請先不要 claim。先做狀態與 fresh evidence audit。

建議起手：

```powershell
node atm.mjs next --prompt "Audit Plan 3.0 and Plan 3.1 dashboard/telemetry/fresh sealed evidence before continuing Plan 4.0; do not open new implementation work until evidence gaps are listed." --json
```

如果要繼續 Plan4 實作，建議等 audit 後再跑：

```powershell
node atm.mjs next --prompt "Continue Plan 4.0 governed implementation from the next unblocked open task after ATM-GOV-0279 and ATM-GOV-0280; preserve foreign WIP." --json
```

如果 `next` 又黏到已關閉任務，請不要人工硬猜；改查 open task queue 或明確指定 `ATM-GOV-0284` 做 preflight。

## 11. Memory Write Check

1. Confirmed pitfall + fix this session?  
   runner-sync receipt commit adapter bug 已寫 backlog，不另寫 memory。

2. Major closure snapshot?  
   0279、0280 已 close/push；本文件就是 handoff snapshot。

3. Human corrected working method?  
   Owner 指正：交接文件必須包含 Plan3.0 / 3.1 / 3.2 / 4.0 全局狀態，且不能忽略 Plan3.0 / 3.1 dashboard metrics 未充分驗證的疑點。已納入本文件。

4. Existing memory proven wrong?  
   none。

