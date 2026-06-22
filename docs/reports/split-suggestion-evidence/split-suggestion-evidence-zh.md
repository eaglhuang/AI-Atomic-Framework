# Split Suggestion Evidence

| scenario | verdict | lane | suggestion |
| --- | --- | --- | --- |
| same-owner-blocked-suggestion | blocked-cid-conflict | blocked | atm.hot-owner-map @ packages/cli/src/commands/broker.ts:10-10 |
| same-owner-close-orch-suggestion | blocked-cid-conflict | blocked | atm.close-orchestration-map @ packages/cli/src/commands/taskflow/close-orchestration.ts:146-150 |

## Notes

- `same-owner-blocked-suggestion`: same owner map remains blocked, but now emits a bounded split suggestion instead of only a hard stop.
- `same-owner-close-orch-suggestion`: the same split-suggestion behavior also appears on a second coarse owner map, showing the output is not tied to one file or one hot-file case.
