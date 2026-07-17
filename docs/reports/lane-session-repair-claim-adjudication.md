# Lane Session Repair-Claim Adjudication

Task: `TASK-LANE-0020`
Subject: `TASK-CODEX-0204`
Adjudication: `valid-orphan-repair`

## Summary

The `2026-07-16T16:52:32.481Z` `repair-claim` event on `TASK-CODEX-0204`
was a valid orphan repair under the active TTL rules. The repaired claim was
owned by `codex-bug-0204`, had its last recorded heartbeat at
`2026-07-16T14:13:16.533Z`, and used the default `ttlSeconds: 1800`.
That lease expired at `2026-07-16T14:43:16.533Z`, more than two hours before
`codex-lane-0011` ran the repair.

The event is therefore not counted as cross-lane interference. It should still
be treated as useful dogfood evidence because the repair event was committed
later than the delivery commit, making the timeline harder to reconstruct from
commit order alone.

## Timeline

| Time (UTC) | Actor | Task | Event | Evidence |
| --- | --- | --- | --- | --- |
| `2026-07-16T14:13:08.585Z` | none | `TASK-CODEX-0204` | import | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T14-13-08-585Z-import-6bb9652c91be.json` |
| `2026-07-16T14:13:16.527Z` | `codex-bug-0204` | `TASK-CODEX-0204` | reserve | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T14-13-16-527Z-reserve-b7c48cb28303.json` |
| `2026-07-16T14:13:16.530Z` | `codex-bug-0204` | `TASK-CODEX-0204` | promote | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T14-13-16-530Z-promote-cf00d63dcc06.json` |
| `2026-07-16T14:13:20.084Z` | `codex-bug-0204` | `TASK-CODEX-0204` | claim | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T14-13-20-084Z-claim-c998639c9920.json` |
| `2026-07-16T14:13:51.071Z` | `codex-bug-0204` | `TASK-CODEX-0204` | scope amendment | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T14-13-51-071Z-scope-amendment-29985a2e556d.json` |
| `2026-07-16T14:43:16.533Z` | derived | `TASK-CODEX-0204` | claim TTL expiry | `heartbeatAt 2026-07-16T14:13:16.533Z + ttlSeconds 1800` in `git show c30730934:.atm/history/tasks/TASK-CODEX-0204.json` |
| `2026-07-16T16:52:32.481Z` | `codex-lane-0011` | `TASK-CODEX-0204` | repair-claim | `.atm/history/task-events/TASK-CODEX-0204/2026-07-16T16-52-32-481Z-repair-claim-2a7998b94993.json` |
| `2026-07-16T16:52:38.251Z` | `codex-lane-0011` | `TASK-LANE-0011` | claim | `.atm/history/tasks/TASK-LANE-0011.json` |
| `2026-07-16T16:54:33.180Z` | `codex-lane-0011` | lane session | lane snapshot minted | `.atm/runtime/lane-sessions/lane-20260716165433-codex-lane-0011-4330503a5d.json` |
| `2026-07-17T01:49:18.104Z` | `codex-worktree-cleanup` | `TASK-CODEX-0204` | cleanup claim | `.atm/history/task-events/TASK-CODEX-0204/2026-07-17T01-49-18-104Z-claim-83bec64ef19d.json` |
| `2026-07-17T01:53:47.582Z` | `codex-worktree-cleanup` | `TASK-CODEX-0204` | close | `.atm/history/task-events/TASK-CODEX-0204/2026-07-17T01-53-47-582Z-close-b94aef1d6eb4.json` |

## Claim Freshness

The historical task document committed in delivery commit `c30730934` records:

- `claim.actorId`: `codex-bug-0204`
- `claim.leaseId`: `lease-d0ccd8b309bb`
- `claim.claimedAt`: `2026-07-16T14:13:16.533Z`
- `claim.heartbeatAt`: `2026-07-16T14:13:16.533Z`
- `claim.ttlSeconds`: `1800`
- `claim.state`: `active`

At the repair timestamp, the claim age was about `9555.948` seconds. The
claim was about `7755.948` seconds past its TTL expiry. No later
`TASK-CODEX-0204` heartbeat, renew, or lane-session ownership record by
`codex-bug-0204` was found before the repair event.

Conclusion: `TASK-CODEX-0204` was not protected by a fresh heartbeat or active
lane ownership at `2026-07-16T16:52:32.481Z`.

## Repair Event Assessment

The repair command was:

```shell
node atm.mjs tasks repair-claim --task TASK-CODEX-0204 --actor codex-lane-0011 --write --reason "release expired conflicting claim blocking TASK-LANE-0011 atom-cli-router admission; do not mutate TASK-CODEX-0204 deliverables" --json
```

The command stated that the old claim was expired and that the repair should
not mutate `TASK-CODEX-0204` deliverables. The available evidence supports the
expired-claim premise.

The event also used the original `codex-bug-0204` session id in the transition
payload while recording `actorId: codex-lane-0011`. That is a bookkeeping
oddity, not enough to overturn the TTL result. It should be interpreted as an
event attribution caveat: the repair actor is `codex-lane-0011`; the stale
session id identifies the repaired lifecycle lane.

## Commit-Order Caveat

Commit `c30730934` delivered the `TASK-CODEX-0204` source changes and recorded
the original claim events, but it did not include the `16:52` repair event.
That repair event was later committed in `161217f7d` together with cleanup
claim state. The final close landed in `257fa2d04`.

This means commit order alone is insufficient for reconstructing the incident.
The event timestamps, task event stream, and task ledger snapshots must be used
together.

## Backlog Decision

No new ATM backlog item is required for this specific event because the final
adjudication is `valid-orphan-repair`, not `cross-lane-interference` or
`ambiguous-needs-guard`.

The broader measurement gap remains covered by `TASK-LANE-0019`: lane session
events need durable history so future analyzer runs can distinguish active
lane ownership from expired task claims without reconstructing the case by
hand.

## Final Ruling

`TASK-CODEX-0204` was not protected by a fresh heartbeat or lane ownership at
the time of repair. The `codex-lane-0011` repair is adjudicated as
`valid-orphan-repair`.
