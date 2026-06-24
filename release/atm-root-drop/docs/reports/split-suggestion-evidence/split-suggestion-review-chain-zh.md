# Split Suggestion Review Chain

本報告補齊 broker blocked -> curator patch draft -> human-reviewable split plan 的完整鏈條。

## Artifacts

- Pending queue JSON: `docs/reports/split-suggestion-evidence/split-suggestion-review-queue.json`
- Pending queue Markdown: `docs/reports/split-suggestion-evidence/split-suggestion-review-queue.md`
- Approved queue JSON: `docs/reports/split-suggestion-evidence/split-suggestion-review-approved-queue.json`
- Approved queue Markdown: `docs/reports/split-suggestion-evidence/split-suggestion-review-approved-queue.md`
- Decision log: `docs/reports/split-suggestion-evidence/map-curator.patch.same-owner-blocked-suggestion.approve.json`
- Decision log: `docs/reports/split-suggestion-evidence/map-curator.patch.same-owner-close-orch-suggestion.approve.json`

## Cases

| case | owner atom | target map | target file | queue status | review decision |
| --- | --- | --- | --- | --- | --- |
| same-owner-blocked-suggestion | atm.hot-owner-map | ATM-MAP-0002 | packages/cli/src/commands/broker.ts | approved | approve |
| same-owner-close-orch-suggestion | atm.close-orchestration-map | ATM-MAP-0001 | packages/cli/src/commands/taskflow/close-orchestration.ts | approved | approve |

## Notes

- admission / apply 的 blocked evidence 仍保留在 broker split suggestion artifacts；本批只補 review queue 與 curator approval 鏈。
- queue proposal 保持 `behavior.split` + `decompositionDecision: split`，但不直接改 registry、不直接改 atom map。
- curator approval 的產物是 human-reviewable split plan，不是自動 promotion。
