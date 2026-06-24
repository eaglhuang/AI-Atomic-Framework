# Split Suggestion Evidence

| scenario | verdict | lane | suggestion kind | suggestion | suggested atoms | curator patch draft |
| --- | --- | --- | --- | --- | --- | --- |
| same-owner-blocked-suggestion | blocked-cid-conflict | blocked | coarse-owner-map-split | atm.hot-owner-map @ packages/cli/src/commands/broker.ts:10-10 | focus:atm.hot-owner-map.focus.10-10:10-10<br>before:atm.hot-owner-map.before.1-9:1-9<br>after:atm.hot-owner-map.after.11-20:11-20 | atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json<br>atomic_workbench/atomization-coverage/path-to-atom-map.json<br>replace-owner-range, add-child-atom-row, add-child-atom-row, add-child-atom-row, rebuild-projection |
| same-owner-close-orch-suggestion | blocked-cid-conflict | blocked | coarse-owner-map-split | atm.close-orchestration-map @ packages/cli/src/commands/taskflow/close-orchestration.ts:146-150 | focus:atm.close-orchestration-map.focus.146-150:146-150<br>before:atm.close-orchestration-map.before.120-145:120-145<br>after:atm.close-orchestration-map.after.151-180:151-180 | atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json<br>atomic_workbench/atomization-coverage/path-to-atom-map.json<br>replace-owner-range, add-child-atom-row, add-child-atom-row, add-child-atom-row, rebuild-projection |

## Notes

- `same-owner-blocked-suggestion`: same owner map remains blocked, but now emits a bounded split suggestion and a curator-facing atom-map patch draft instead of only a hard stop.
- `same-owner-close-orch-suggestion`: the same split-suggestion behavior also appears on a second coarse owner map, showing the output is not tied to one file or one hot-file case.
- Curator patch draft report: `split-suggestion-curator-report.json` (patchDrafts=2).
