# Broker Evidence Bundle

- Scan at: 2026-06-21T15:45:15.281Z
- Total runs: 3
- Total tasks: 2

## Run Index
| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| registry-TASK-TEAM-BROKER-HOT-FIRST | TASK-TEAM-BROKER-HOT-FIRST | field | TASK-TEAM-BROKER-HOT-FIRST | coordinator-1 | broker-registry | direct-brokered:proposal-submitted | recorded:proposal-submitted | packages/cli/src/commands/broker.ts | intent-1782056714002 | f157711da0b42bef4665d554949190a622f39bdd | intent-1782056714002 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnyjzb3-tr63kf5g/.atm/runtime/write-broker.registry.json |
| steward-merge-37e2c6d6dab54d12 | merge-37e2c6d6dab54d12 | field | TASK-TEAM-BROKER-HOT-DISJOINT,TASK-TEAM-BROKER-HOT-FIRST | coordinator-1,coordinator-2 | steward.patch-apply | neutral-steward | mergeable | packages/cli/src/commands/broker.ts | proposal-hot-first,proposal-hot-second | f157711da0b42bef4665d554949190a622f39bdd | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnyjzb3-tr63kf5g/.atm/runtime/proposal-gated-hot-apply.json |
| team-aa48783f592c | TASK-TEAM-BROKER-HOT-DISJOINT | field | TASK-TEAM-BROKER-HOT-DISJOINT | coordinator-2 | team-broker-lane | deterministic-composer:composer-routed | needs-physical-split:composer-routed | packages/cli/src/commands/broker.ts | n/a | f157711da0b42bef4665d554949190a622f39bdd | decision-1782056714210,txn-4bdf8f70d6eee701 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnyjzb3-tr63kf5g/.atm/runtime/team-runs/team-aa48783f592c.json |

## Task Artifact Index
| taskId | closurePacket | teamRuns |
| --- | --- | --- |
| TASK-TEAM-BROKER-HOT-DISJOINT | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnyjzb3-tr63kf5g/.atm/runtime/team-runs/team-aa48783f592c.json |
| TASK-TEAM-BROKER-HOT-FIRST | n/a | n/a |
