# packages/cli/dist 過舊提案（未修，超出快修範圍）

## 現況
- `packages/cli/dist` 有 1,451 個追蹤檔；最後一次更新是 96fb1ade73（TASK-PRF-0159 source bundle，2026-10-22）。
- 之後 `packages/cli/src` 又有 23 個提交（到 ccea864，2026-10-25），包括 #416/#420/#421/#422 等快修和 PR，dist 都沒跟著更新。
- 結果：本機 `npm run build` 會改 45 個 dist 檔 + 2 個 release-manifest.json。

## 原因
1. dist 只在 taskflow source-bundle / sealed runner build 的交付路徑裡才會被重建並提交；快修通道和一般 PR merge 只動 src。
2. `scripts/build-release-hygiene.ts` 預設只還原 `release/atm-onefile`、`release/atm-root-drop` 的追蹤輸出，不管 `packages/cli/dist`，所以本機 build 會把 dist 留成髒的。
3. CI（.github/workflows/ci.yml）沒有 dist 新鮮度檢查（只有 release-npm.yml 會建 dist，不比對）。
4. frozen runner 把 `packages/cli/dist/atm.js` 當作來源之一，所以不能單純把 dist 列進「build 後還原」，否則 runner sync 會壞。

## 選項
A. 一次性 runner sync：由 release-steward 走 sealed build 正式重建並提交 dist + release（約 47 檔，要任務卡 + 簽核）。治標。
B. CI 新鮮度檢查：在 ci.yml 加一步 `npm run build:packages && git diff --exit-code packages/cli/dist`，src 改了但 dist 沒更新的 PR 會紅燈（1–2 檔，但會讓所有現有 PR 先紅，需先做 A）。
C. 快修/PR 流程：merge 後由 steward queue 自動排一次 runner sync（改 runner-sync steward 佇列邏輯 + 測試，約 3–5 檔，要任務卡）。
D. 長期：不再提交 dist，改由 release 時產生（變動大，影響 frozen runner 設計，要 RFC）。

## 建議
先做 A 讓 main 回到一致，再加 B 防止再次漂移；C/D 之後再評估。A、B 都需要你簽核（A 會改治理/發佈紀錄）。
