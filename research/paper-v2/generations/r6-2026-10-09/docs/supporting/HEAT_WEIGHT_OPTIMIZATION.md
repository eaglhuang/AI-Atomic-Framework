# ATM 經驗驅動冷熱權重與 Composer 頻率優化方案

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei） |
| 動機 | 現行熱檔判定為靜態 basename 集合（二元 hot/cold）；不符合「依個體使用經驗升降溫」與論文可複現 playbook |
| 現況錨點 | `packages/core/src/broker/team-lane.ts`：`HOT_FILE_BASENAMES = {tasks.ts, next.ts, evidence.ts, hook.ts, team.ts, broker.ts}` → 命中即 `hot-file` trigger → proposal-first／高機率 composer |
| harness 經驗 | h1-a8：native ~24% reject、0 lost（composer 真 merge 時）；loop overlay → 100%（#181）；冷檔 wait 靠 overlay（#180）；composer 不做 apply 時 lost ≈ control |

## 1. 設計目標

1. **權重取代二元標籤**：路徑／atom 有連續熱度 `heat ∈ [0,1]`，再映射到 lane／Composer 頻率。
2. **個體經驗驅動**：每個 repo（可選：每個 team／branch family）用自己的 admission 結果與結果回饋更新熱度。
3. **自動升降溫**：熱度上升 → 更常 provisional／composer；下降 → 更常 direct／cold serial。
4. **可解釋＋可複現**：每次決策帶 `heat`、信號分解、門檻版本；同一 seed＋同一 heat 快照 → 同一路由分布。
5. **不破壞 fail-closed**：權重只調「走哪條安全 lane 的偏好」，不放寬 true-conflict／CAS／authority。

非目標：複製 Claim Plane JIT；用權重繞過 #180/#181 的正確性缺口。

## 2. 核心模型：`FileHeatLedger`

### 2.1 鍵

- 主鍵：`canonicalPath`（posix、相對 repo root）
- 可選細粒度：`path#region` 或 `path#atomId`（熱區比熱檔更準；先 path，後 region）

### 2.2 狀態（持久化，建議 `atm.fileHeat.v1` JSON／registry 旁路）

```json
{
  "schemaId": "atm.fileHeat.v1",
  "specVersion": "0.1.0",
  "repoId": "<content-addressed or remote>",
  "updatedAt": "ISO-8601",
  "entries": {
    "src/broker.ts": {
      "heat": 0.72,
      "emaConflict": 0.41,
      "emaComposeSuccess": 0.88,
      "emaWaitMs": 42,
      "emaReject": 0.18,
      "touchCount": 126,
      "lastTouchAt": "...",
      "laneBias": "composer-preferred",
      "frozen": false
    }
  },
  "policyId": "heat-policy.v1",
  "policyDigest": "<hash of thresholds>"
}
```

### 2.3 觀測信號（每次 intent 結束寫入，離線可重放）

| 信號 | 來源 | 含義 |
|------|------|------|
| `overlap_hit` | broker overlap／同檔 active | 爭用密度 |
| `true_conflict` | disposition reject／blocked-active-lease | 同區硬撞 |
| `composer_routed` | lane=deterministic-composer | 走了 Composer |
| `composer_ok` / `composer_steward` / `composer_fail` | compose／steward 結果 | Composer 是否划算 |
| `provisional_grant` / `provisional_hold_ms` | lease 生命週期 | 熱檔獨佔成本 |
| `wait_ms` | queue／park／retry（含 #180/#181 落地後） | 排隊成本 |
| `cas_retry` / `lost_oracle`（僅 harness） | CAS／oracle | 正確性壓力 |
| `direct_ok` | cold／低熱成功直寫 | 降溫證據 |
| `manual_override` | 人類／playbook pin | 凍結或強制熱度 |

更新用指數移動平均（EMA），預設 `α = 0.15`（可配置）；`touchCount` 少於 `N_min=8` 時用先驗，避免一两次碰撞就烙鐵。

### 2.4 熱度合成（建議起點，可校準）

```
raw = w1·emaConflict
    + w2·emaReject
    + w3·composerPressure      # routed 且常成功 → 偏熱但可控
    + w4·normalize(emaWaitMs)
    − w5·emaDirectOk
    − w6·decay(idleDays)

heat = clamp(0, 1, sigmoid(prior, raw))
```

建議權重初值：`w1=0.35, w2=0.25, w3=0.20, w4=0.15, w5=0.20, w6=0.10`（正規化後）。

**Composer 壓力**：`composerPressure = emaComposeRouted · emaComposeSuccess`  
→ 「常被送去 composer 且常成功」提高熱度（值得常走 composer）；  
「常送去但常 fail／steward」提高熱度同時 **提高 serial 偏好**（見 §3），避免盲目加 composer 頻率。

### 2.5 滯回（防抖升降溫）

| 動作 | 條件 |
|------|------|
| 升溫一檔 | `heat` 連續 `K_up=3` 次觸碰 ≥ 上檔門檻，且距上次調檔 ≥ `T_cool=5min` |
| 降溫一檔 | `heat` 連續 `K_down=5` 次觸碰 ≤ 下檔門檻（降溫更保守） |
| 急凍升溫 | 單次 `true_conflict` 叢集（短窗 ≥3）→ 立即 `heat = max(heat, 0.75)` |
| 衰減 | `idleDays` 每滿 1 天 `heat *= 0.92`（下限先驗） |

先驗：`prior = basename ∈ legacy HOT_FILE_BASENAMES ? 0.65 : 0.20`（過渡期相容靜態表）。

## 3. 權重 → lane／Composer 頻率（不是再切二元）

設檔案熱度 `H`，intent 當下再乘 **即時爭用因子** `C`：

```
C = 1 − exp(−λ · activeWritersOnPath)   # λ≈0.7
score = clamp(0,1, 0.6·H + 0.4·C)
```

### 3.1 軟路由表（可版本化 `heat-policy.v1`）

| score 區間 | 偏好 lane | Composer 行為 | 備註 |
|------------|-----------|---------------|------|
| `[0, 0.25)` | `direct-brokered`（無重疊）／`serial`（有重疊且 #180） | 幾乎不送 composer（`p_compose≈0`） | 冷檔 |
| `[0.25, 0.45)` | 有界重疊 → 低機率 composer | `p_compose = f(score)` | 微熱 |
| `[0.45, 0.70)` | `provisional-write-lease` 優先 | 第二 writer：`p_compose` 高 | 標準熱 |
| `[0.70, 0.85)` | provisional + 積極 composer | 幾乎必 composer；true-conflict → **park**（#181） | 高熱 |
| `[0.85, 1]` | composer-preferred／必要時 serial | composer 失敗率高則強制 serial | 過熱保護 |

**頻率函數（可重現）**：

```
p_compose(score) = smoothstep(0.30, 0.75, score)
# 例：0.30→0, 0.45→0.25, 0.60→0.64, 0.75→1
```

決策時用 **穩定偽隨機** `hash(taskId ‖ path ‖ policyDigest) < p_compose`  
→ 同一 intent 重放結果不變（論文／新人 playbook 可複現）；不是每次擲骰。

### 3.2 與現有 disposition 對齊

| 既有結果 | 權重如何用 |
|----------|------------|
| `true-conflict` / blocked lease | **不**用權重放行；只影響是否 park／重試（#181）與後續升溫 |
| `composer-routed` | 提高 `p_compose` 的意圖已實現；記錄成功／失敗回饋 |
| `provisional-write-lease` | 中高 `H` 時優先於直接 composer（保留「先租約」語意） |
| cold serial（#180） | 低 `H` + 同檔重疊 → queue，不假熱 |

## 4. 回饋閉環（「個體使用經驗」）

```
WriteIntent
  → 讀 FileHeatLedger（H）
  → 算 score、選 lane / p_compose
  → broker 既有閘門（overlap / lease / CAS）【權威不變】
  → 執行（direct / provisional / composer / serial / park）
  → OutcomeReceipt（含 wait_ms、compose_*、reject）
  → EMA 更新 ledger
  → 可選：寫 HeatDecisionReceipt（給 doctor／論文表）
```

**作用域**：預設 per-repo ledger；可選 `ATM_HEAT_SCOPE=repo|team|user`。跨 repo 不自動合併（避免污染）；可 export playbook 模板。

## 5. Playbook（新人＋論文可複現）

### 5.1 新人可讀規則（沉成 skill／docs 一段）

1. 新 repo：先用 basename 先驗（舊表）當 `prior`，跑 1–2 天或 N≥50 intents 再信 EMA。
2. 看 `atm heat status`：哪些檔 `H>0.7`、Composer 成功率、reject／wait。
3. 手動 pin：`atm heat pin path --heat 0.8`（凍結）；`unpin` 恢復學習。
4. 過熱保護：Composer 失敗率 > 閾值 → 自動偏 serial，並提示修 adapter／region。
5. 對照實驗：`--heat-policy off|static|learned` 三臂（對應 harness）。

### 5.2 論文複現包

每次公開 run 附：

- `heat-ledger.snapshot.json`（跑前凍結）
- `heat-policy.v1.json` + digest
- `events.jsonl`（含 `heat`, `score`, `p_compose`, `lane`）
- seed／scenario（既有 atm-bench）

聲明：**學習在實驗前凍結**；run 中可記錄但不回寫（避免非平穩）。線上產品模式才邊跑邊學。

## 6. 實作分期（建議）

| 階段 | 內容 | 依賴 |
|------|------|------|
| **P0** | `FileHeatLedger` 讀寫＋receipt 欄位；靜態 basename → prior；決策仍二元但 **記錄** 若用權重會走哪 | 無 |
| **P1** | `score → p_compose` 軟路由（僅 proposal 已需要的路徑）；doctor 顯示熱度 | 現有 composer |
| **P2** | EMA 回饋閉環＋滯回升降溫＋pin CLI | P0/P1 |
| **P3** | 與 #180 serial queue、#181 park 接上：低熱重疊→queue；高熱 true-conflict→park | #180 #181 |
| **P4** | region/atom 級熱度；過熱→serial 保護；harness 三臂對照寫進 ATM v2 | P2/P3 |

## 7. harness 驗證計畫（接 atm-bench）

新增 arms：

| arm | 行為 |
|-----|------|
| `heat_static` | 現行 basename 二元（基線） |
| `heat_learned_frozen` | 用預熱 ledger，run 中不更新 |
| `heat_online` | run 中 EMA 更新（產品模擬；論文慎用） |

指標：

- 成功率／lost／reject 率（對齊 HOT_FILE_LATENCY）
- `composer_routed` 比例 vs `H` 分桶（應單調上升）
- wall／wait_ms：中熱應低於「全熱必 composer」；高熱應接近 loop overlay
- 升降溫次數／抖動率（滯回是否有效）

成功標準（建議）：

1. 同 seed 下 `heat_learned_frozen` 可位元級重放 lane 分布。
2. 相對 `heat_static`：在混合 hot_ratio∈[0.3,0.8] 時，等正確性下 wall 或 reject 至少一項改善 ≥10%。
3. 不增加 lost update（composer apply 開時）。

## 8. 風險與護欄

| 風險 | 護欄 |
|------|------|
| 熱度被惡意／異常意圖帶飛 | `N_min`、滯回、pin、過熱→serial；ledger 寫入需同 repo authority |
| 學成「永遠 composer」拖慢 | `emaComposeSuccess` 低 → 降 `p_compose`、升 serial |
| 論文不可複現 | 實驗凍結 ledger；穩定 hash 門檻 |
| 與靜態表行為突變 | 過渡雙軌：`ATM_HEAT_MODE=static\|hybrid\|learned`，預設 hybrid（prior+EMA） |
| 誤以為可取代 admission | 文件明示：權重只選 lane 偏好，true-conflict／CAS 仍硬閘 |

## 9. 與 ATM v2 敘事的關係

- **可寫進論文的主張**：冷熱不是標籤，而是 **可學習、可快照、可重放的爭用先驗**；Composer 頻率是熱度的單調函數，並用 harness 給曲線。
- **不搶主線**：仍先補 #180 原生 queue、#181 park；本方案是「成熟度＋可複現」層，不是 ChangeIntent/JIT。
- **Raven 對齊點**：把熱度決策沉成 playbook／skill（契約＋可解釋 admission），不是 Host-of-harnesses。

## 10. 一句話

用 **per-repo EMA 熱度權重 + 滯回升降溫 + 穩定 `p_compose(score)`** 取代靜態 basename 二元熱檔；權威閘門不變，經驗只調「多常走 Composer／provisional／serial」，並用凍結 ledger 讓新人 playbook 與論文實驗可複現。


## 11. 急升緩降（使用者鎖定）

- **升溫快**：同一 path 連續 touch／有人來改 → 立刻抬 `heat`（建議每次 touch `heat = min(1, heat + Δ_up)`，Δ_up≈0.12–0.20；或短窗連撞 true-conflict 急凍）。
- **降溫慢**：只有「一陣子沒人用」才衰減（建議每日 `heat *= 0.92`～`0.95`，或 idle 滿 T 天後才開始降）；不要因單次直寫成功就大幅降溫。
- **滯回不對稱**：升檔門檻連過 2–3 次即可；降檔要連過 5+ 次或長 idle。

## 12. 小改＋建議一起動的配套（最小集合）

熱度本體可以很小（取代／旁路 `HOT_FILE_BASENAMES` + `p_compose(H)`）。建議**同 PR 或緊接**只帶這些，避免再開一條平行學習系統：

| 配套 | 為什麼一起改 | 工作量 |
|------|--------------|--------|
| Admission receipt 加 `heat`／`p_compose`／`heatSignals` | doctor、harness、論文可解釋；零行為風險 | 極小 |
| `.atm/runtime/file-heat.json`（或 registry 旁路）+ 急升緩降更新 | 個體經驗落地處 | 小 |
| `ATM_HEAT_MODE=static\|hybrid\|learned`（預設 hybrid） | 可回滾、論文三臂 | 極小 |
| 高熱／過熱時寫一筆 **experience-loop** 候選或 memory-nudge（不自動 promote） | 接既有 Skill 成長管線，不另造 Skill Forge | 小 |
| governance-router／dispatch `learning-loop` 加一類 `contention-heat`（或歸 `shared-atm-routing-friction`） | 新人 skill 可讀「為何這檔變熱」 | 小（文件＋一則 template） |
| atm-bench 一臂讀凍結 heat ledger | 複現曲線 | 小 |

**不要**為熱度重做一套 skill 自學習；ATM 已有：

1. `packages/plugin-experience-loop`：從 evidence 抽 `SkillCandidate`／`SkillAmendment`／`MemoryNudge`，**審核後才 promote**（`docs/EXPERIENCE_LOOP.md`）。
2. `docs/governance/skills/shared-growth-contract.md`（SKL）：`SKILL.md` 穩態規則 + `references/learning-loop.md` 案例，case→pattern 晉升條。
3. `guide learn` host-local intent lexicon（`.atm/guidance/intent-lexicon.json`）。
4. Atom Map Curator（訊號→map 提案，非自動改寫 skill）。

熱度 = **runtime 數值先驗**；Skill 成長 = **可審核的文字／路由課**。對接方式：熱度跨線 → 發 experience 提案／nudge → 通過 review 才進 learning-loop／SKILL.md。

可延後（非本小改必須）：#180 serial、#181 park、region 級熱度、線上自動改 `HOT_FILE_BASENAMES` 表本身。
