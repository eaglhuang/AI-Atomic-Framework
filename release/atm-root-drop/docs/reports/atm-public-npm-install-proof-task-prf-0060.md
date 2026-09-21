# TASK-PRF-0060 — Complete npm runtime-boundary evidence

狀態：`open`／候選包驗證通過；公開 registry 交付仍阻塞。本文只記錄本卡可重跑的證據，不宣稱 npm release 已完成。

## 目的與邊界

本卡驗證 npm runtime 的「可達資產閉包」與 clean-consumer 行為，並以固定量測記錄目前候選包和公開 `@ai-atomic-framework/cli@0.1.0` 的差異。依 deep-module review 的結論，維持單一 self-contained runtime；不啟用 code-splitting、不額外下載 runtime chunk、不 publish、不 push。

## Fresh validators

以下五個命令已由 ATM evidence ledger 以 source commit `0954af241ed96e9dac2eb2539a15e95eed2e84b5` 記錄，全部 exit code 0：

- `npm run build --workspace packages/cli`
- `node --strip-types tests/cli/public-npm-install-contract.test.ts`
- `node --strip-types tests/cli/adopter-artifact-budget.test.ts`
- `npm run validate:candidate-npm-install -- --candidate-dir packages/cli --measurement-runs 3 --record-blocked`
- `npm run validate:public-npm-install -- --package @ai-atomic-framework/cli --version 0.1.0 --record-blocked --measurement-runs 1`

## 候選包結果（clean consumer）

候選包由 `packages/cli` 實際 `npm pack` 後安裝到暫存 consumer；`usedWorkspaceLink=false`，完整 7 命令矩陣均執行，沒有 module-resolution failure。

| 指標 | 候選結果 |
| --- | ---: |
| version | `0.1.0` |
| tarball bytes | `742,459` |
| tarball SHA-256 | `1512f11910472957e0478d8beb317fea534b348b1b577a46d189e65df0eb8cbc` |
| unpacked bytes | `2,684,504` |
| entries | `71` |
| install time（一次 clean install） | `1,346.09 ms` |
| measurement runs | `3` |
| core workflow | `PASS` |
| command matrix | `version`, `doctor`, `next`, `tasks`, `bootstrap`, `atm-chart-render`, `atm-chart-verify` |
| asset closure | 6 個 chart source schema 全部存在 |

六個已驗證存在的 schema：

`layout/schemas/agent-prompt.schema.json`、`layout/schemas/atomic-spec.schema.json`、`layout/schemas/charter/charter-invariants.schema.json`、`layout/schemas/governance/default-guards.schema.json`、`layout/schemas/integrations/install-manifest.schema.json`、`layout/schemas/upgrade/upgrade-proposal.schema.json`。

## 公開 registry 結果（仍阻塞）

公開 `@ai-atomic-framework/cli@0.1.0` 的 clean consumer 也沒有 workspace link，且 7 個命令都有執行；但 `atm-chart-render` 與 `atm-chart-verify` 皆 exit code 2，故 `coreWorkflowPassed=false`、`passed=false`。registry 目前量測為 `3,357,358` unpacked bytes、`78` entries，tarball SHA-256 為 `e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14`。

此差異證明目前「候選 dist 已含閉包」不等於「公開 npm 版本已更新」。在完成正式 release／trusted publishing 前，不得把產品原則中的可安裝套件證據標為完成。

## Fixed-baseline comparison

`--measure --measurement-runs 3` 以公開 `0.1.0` 作為固定 baseline，分別在兩個 clean consumer 從 tarball 安裝；完整原始 receipt 位於 repo 外：

`C:\Users\User\atm-benchmark-sink\TASK-PRF-0060\baseline-candidate-measurement-20260914T0420Z.json`

receipt SHA-256：`DAC4C5BF41F7F9E2369558B6D8306330B1204C1C12C91FF3192522817AE2D91E`。

| 指標 | 公開 baseline `0.1.0` | 本地候選 | 差異／判定 |
| --- | ---: | ---: | --- |
| tarball bytes | 930,492 | 742,459 | -188,033 |
| unpacked bytes | 3,357,358 | 2,684,504 | -672,854（-20.041%）PASS |
| entries | 78 | 71 | -7（-8.974%）FAIL，未達 15% |
| install time | 1,411.13 ms | 1,371.35 ms | -39.78 ms（單次觀測） |
| dependencies | `ajv`, `ajv-formats`（2 direct） | `ajv`, `ajv-formats`（2 direct） | footprint 相同 |
| workflow 行為 | chart render/verify exit 2 | chart render/verify exit 0 | core workflow candidate PASS；baseline failure 保留 |

候選命令無 module-resolution failure，且 baseline/candidate 的 legacy smoke exit code 一致；但 entry-count reduction 未達門檻，因此 receipt 的 `acceptance.passed=false`。這是本卡的 stop-rule 結果，不是可發布的綠燈。

## 解讀與 stop rule

1. runtime asset closure 與候選 clean-install 已通過，可作為下一次 release 的候選輸入。
2. 本卡沒有足夠證據宣稱相對固定基線的體積下降；單一 bundle 的正確性優先，不能用拆 chunk 或刪除可達資產製造假瘦身。
3. 公開 registry 的 chart failure 是真實 blocker；下一個授權的 release lane 必須重新 pack、publish 後以指定版本重跑 public validator，再更新正式 public-install proof。
4. 在 registry 驗證通過前，本卡保持 `open`，不 close、不 publish、不 push。

## Evidence references

- ATM bundle：`.atm/history/evidence/TASK-PRF-0060.bundle-manifest.json`
- evidence ledger：`.atm/runtime/evidence-ledger/bundles/TASK-PRF-0060.json`
- public proof baseline：`docs/reports/atm-public-npm-install-proof.md`
