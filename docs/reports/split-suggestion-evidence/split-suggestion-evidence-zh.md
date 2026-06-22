# Split Suggestion Evidence

| scenario | verdict | lane | suggestion kind | suggestion | suggested atoms |
| --- | --- | --- | --- | --- | --- |
| same-owner-blocked-suggestion | blocked-cid-conflict | blocked | coarse-owner-map-split | atm.hot-owner-map @ packages/cli/src/commands/broker.ts:10-10 | focus:atm.hot-owner-map.focus.10-10:10-10 |
| same-owner-close-orch-suggestion | blocked-cid-conflict | blocked | coarse-owner-map-split | atm.close-orchestration-map @ packages/cli/src/commands/taskflow/close-orchestration.ts:146-150 | focus:atm.close-orchestration-map.focus.146-150:146-150 |

## Notes

- `same-owner-blocked-suggestion`: same owner map remains blocked, but now emits a bounded split suggestion instead of only a hard stop.
- `same-owner-close-orch-suggestion`: the same split-suggestion behavior also appears on a second coarse owner map, showing the output is not tied to one file or one hot-file case.
