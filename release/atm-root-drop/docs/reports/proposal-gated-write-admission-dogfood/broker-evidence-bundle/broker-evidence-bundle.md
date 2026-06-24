# Broker Evidence Bundle

- Scan at: 2026-06-21T16:09:59.474Z
- Total runs: 3
- Total tasks: 2

## Run Index
| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| registry-TASK-TEAM-BROKER-HOT-FIRST | TASK-TEAM-BROKER-HOT-FIRST | field | TASK-TEAM-BROKER-HOT-FIRST | coordinator-1 | broker-registry | direct-brokered:proposal-submitted | recorded:proposal-submitted | packages/cli/src/commands/broker.ts | intent-1782058198958 | 9667c7154054bbef99f8d6e87b519920126f6a2d | intent-1782058198958 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnzfta6-u2c1ogqg/.atm/runtime/write-broker.registry.json |
| steward-merge-37e2c6d6dab54d12 | merge-37e2c6d6dab54d12 | field | TASK-TEAM-BROKER-HOT-DISJOINT,TASK-TEAM-BROKER-HOT-FIRST | coordinator-1,coordinator-2 | steward.patch-apply | neutral-steward | mergeable | packages/cli/src/commands/broker.ts | proposal-hot-first,proposal-hot-second | 9667c7154054bbef99f8d6e87b519920126f6a2d | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnzfta6-u2c1ogqg/.atm/runtime/proposal-gated-hot-apply.json |
| team-39e8743de664 | TASK-TEAM-BROKER-HOT-DISJOINT | field | TASK-TEAM-BROKER-HOT-DISJOINT | coordinator-2 | team-broker-lane | deterministic-composer:composer-routed | needs-physical-split:composer-routed | packages/cli/src/commands/broker.ts | n/a | 9667c7154054bbef99f8d6e87b519920126f6a2d | decision-1782058199045,txn-e3c0ea5151f75a8e | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnzfta6-u2c1ogqg/.atm/runtime/team-runs/team-39e8743de664.json |

## Task Artifact Index
| taskId | closurePacket | teamRuns |
| --- | --- | --- |
| TASK-TEAM-BROKER-HOT-DISJOINT | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqnzfta6-u2c1ogqg/.atm/runtime/team-runs/team-39e8743de664.json |
| TASK-TEAM-BROKER-HOT-FIRST | n/a | n/a |
