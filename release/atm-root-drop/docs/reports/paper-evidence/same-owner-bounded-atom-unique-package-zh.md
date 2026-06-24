# 同 owner map、不同 bounded atom 論文證據唯一完整包

## 一句話結論

ATM 目前已具備一條完整證據鏈：當兩個寫入請求落在同一個 coarse owner map，但 proposal 所宣告的 bounded atom 區段彼此分離時，broker 會把該請求送入 `deterministic-composer` 並成功 apply；當兩者落在相同 bounded atom 區段時，broker 會 fail-closed 阻擋，並把 coarse owner map 拆分建議推進到 curator review / approval queue。

## 正向案例：同 owner map、不同 bounded atom 可 merge

- 目標檔案：`packages/cli/src/commands/broker.ts`
- owner map：`atm.hot-owner-map`
- bounded region：`24-28`
- admission state：`composer-routed`
- broker lane：`deterministic-composer`
- broker verdict：`needs-physical-split`
- apply verdict：`applied`
- apply method：`patch-apply`
- merge verdict：`mergeable`
- broker run id：`steward-merge-37e2c6d6dab54d12`
- commit sha：`23743c61c5e497a03ddee5a1d4196069c1730340`

這筆證據說明：ATM 不必把同檔同 owner map 一律視為不可並行；只要 bounded atom 區段可被證明為分離，broker 就能先在 admission 階段改走 composer 路線，再由 steward 完成可追溯的合併寫入。

## 負向案例：同 owner map、相同 bounded atom 必須阻擋

- 目標檔案：`packages/cli/src/commands/broker.ts`
- owner map：`atm.hot-owner-map`
- bounded region：`10-10`
- admission state：`blocked-before-write`
- broker lane：`blocked`
- broker verdict：`blocked-cid-conflict`
- split suggestion kind：`coarse-owner-map-split`
- conflict region：`10-10`
- suggested atoms：`focus:atm.hot-owner-map.focus.10-10:10-10`、`before:atm.hot-owner-map.before.1-9:1-9`、`after:atm.hot-owner-map.after.11-20:11-20`

這筆證據說明：當 proposal bounded region 真正重疊時，ATM 不會因為它們仍屬同一個 owner map 就勉強合併，而是先阻擋寫入，再產生可審查的 split suggestion，保留 fail-closed 的安全性。

## Queue / Approval 證據

- `proposal.map-curator.patch.same-owner-blocked-suggestion`：status=`approved`，decision=`approve`，evidence=`human-review.proposal.map-curator.patch.same-owner-blocked-suggestion.approve`

這筆證據說明：broker 的 blocked 結果不只停在錯誤訊號，而是能往上接到 curator patch draft 與 human-reviewable approval queue，形成「blocked -> suggestion -> review -> approve」的完整治理鏈。

## 可查證 artifact

- summary：`docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-summary.json`
- positive apply：`docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-hot-apply.json`
- broker evidence bundle：`docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.json`
- broker evidence report：`docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.md`
- approved queue：`docs/reports/split-suggestion-evidence/split-suggestion-review-approved-queue.json`
- approved decision：`docs/reports/split-suggestion-evidence/map-curator.patch.same-owner-blocked-suggestion.approve.json`

## 建議貼進論文的繁中段落

在 `packages/cli/src/commands/broker.ts` 的 same-owner bounded-atom dogfood 中，我們觀察到 ATM 已可區分「同一 coarse owner map 下的分離 bounded atom」與「同一 bounded atom 的實質重疊」兩種情形。前者在 proposal-first admission 後被路由至 `deterministic-composer`，並由 steward 完成 `patch-apply`，留下 `mergeable` 的 broker operation evidence；後者則在 admission 階段 fail-closed 為 `blocked-cid-conflict`。更重要的是，阻擋並非終點：broker 會同步提出 coarse owner map split suggestion，該 suggestion 可被提升為 curator patch draft，並進入 human-reviewable approval queue。這表示 ATM 的治理能力不只限於阻擋衝突，也能把 blocked overlap 轉譯為可演進、可審查的 atom-map refinement workflow。

