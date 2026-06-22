# Same Owner Map / Bounded Atom 證據包

## 核心結論

這一輪證據補上了 proposal-first hot-file 路徑在「同 owner map」條件下的關鍵缺口：

1. 同 owner map、不同 bounded atom，不再一律被粗粒度 atom gate 直接擋死。
2. 若兩側 bounded region 可證明互斥，broker 會把第二寫者導向 `needs-physical-split` / `deterministic-composer`，而不是直接 `blocked-cid-conflict`。
3. 若兩側 bounded region 真正重疊，broker 仍維持 fail-closed；但現在會補出 split suggestion，指出 coarse owner map 哪個 bounded region 值得拆細。

## 正向證據

- 目標檔案：`packages/cli/src/commands/broker.ts`
- owner map：`atm.hot-owner-map`
- 正向 bounded region：
  - seed writer: lines `1-20`
  - join writer: lines `24-28`
- runtime 結果：
  - admission state: `composer-routed`
  - verdict: `needs-physical-split`
  - lane: `deterministic-composer` -> team lane `neutral-steward`

這表示 broker 已能接受「同 owner map、同檔案、但 bounded atom 可分離」的真實寫入形狀。

## 負向證據

- 目標檔案：`packages/cli/src/commands/broker.ts`
- owner map：`atm.hot-owner-map`
- 負向 bounded region：
  - seed writer: lines `1-20`
  - join writer: line `10-10`
- runtime 結果：
  - admission state: `blocked-before-write`
  - verdict: `blocked-cid-conflict`
  - lane: `blocked`

這表示 broker 仍然保留 coarse owner map 的保守防線；只有 bounded-region 證據足以證明可分離時，才會開 composer 路徑。

## Split Suggestion

同一筆負向 evidence 還額外產出：

- targetFunction.atomId: `atm.hot-owner-map`
- conflictRegion: `packages/cli/src/commands/broker.ts:10-10`
- constraint: `preserve-signature`

這不是自動改 map，而是 broker 對 coarse owner map 發出的治理建議：這個 region 已經足以被識別與追蹤，適合後續拆成更細 bounded atom。

## Artifact 路徑

- bundle root:
  - `docs/reports/same-owner-bounded-atom-dogfood/`
- summary:
  - `docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-summary.json`
- broker evidence bundle:
  - `docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.json`
  - `docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.md`
- broker run:
  - `docs/reports/same-owner-bounded-atom-dogfood/broker-runs/proposal-gated-hot-run.json`
- team runs:
  - `docs/reports/same-owner-bounded-atom-dogfood/team-runs/`

## 相關指令

```bash
node --strip-types scripts/validate-team-brokered-write.ts --mode validate --retain-artifacts-dir docs/reports/same-owner-bounded-atom-dogfood
node --strip-types scripts/generate-split-suggestion-evidence.ts --output-dir docs/reports/split-suggestion-evidence
```

## 論文寫法建議

論文不應把這組 case 寫成「同 owner map 已完全取消 CID gate」，比較誠實的說法是：

- coarse owner map 仍是第一層 fail-closed 保護；
- bounded-region proposal evidence 讓 broker 能在同 owner map 內辨識可分離寫入；
- 若 bounded region 重疊，broker 仍阻擋，但會留下可審核的 split suggestion，支援後續 atom map 細化。
