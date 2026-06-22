# Broker Evidence Bundle

- Scan at: 2026-06-22T03:53:42.676Z
- Total runs: 3
- Total tasks: 2

## Run Index
| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| registry-TASK-TEAM-BROKER-HOT-FIRST | TASK-TEAM-BROKER-HOT-FIRST | field | TASK-TEAM-BROKER-HOT-FIRST | coordinator-1 | broker-registry | direct-brokered:proposal-submitted | recorded:proposal-submitted | packages/cli/src/commands/broker.ts | intent-1782100421804 | 23743c61c5e497a03ddee5a1d4196069c1730340 | intent-1782100421804 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqookt2m-eowbwr97/.atm/runtime/write-broker.registry.json |
| steward-merge-37e2c6d6dab54d12 | merge-37e2c6d6dab54d12 | field | TASK-TEAM-BROKER-HOT-DISJOINT,TASK-TEAM-BROKER-HOT-FIRST | coordinator-1,coordinator-2 | steward.patch-apply | neutral-steward | mergeable | packages/cli/src/commands/broker.ts | proposal-hot-first,proposal-hot-second | 23743c61c5e497a03ddee5a1d4196069c1730340 | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqookt2m-eowbwr97/.atm/runtime/proposal-gated-hot-apply.json |
| team-90713c63efa3 | TASK-TEAM-BROKER-HOT-DISJOINT | field | TASK-TEAM-BROKER-HOT-DISJOINT | coordinator-2 | team-broker-lane | deterministic-composer:composer-routed | needs-physical-split:composer-routed | packages/cli/src/commands/broker.ts | n/a | 23743c61c5e497a03ddee5a1d4196069c1730340 | decision-1782100422177,txn-4c206d315c7b90e4 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqookt2m-eowbwr97/.atm/runtime/team-runs/team-67828e28db12.json |

## Task Artifact Index
| taskId | closurePacket | teamRuns |
| --- | --- | --- |
| TASK-TEAM-BROKER-HOT-DISJOINT | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqookt2m-eowbwr97/.atm/runtime/team-runs/team-67828e28db12.json |
| TASK-TEAM-BROKER-HOT-FIRST | n/a | n/a |
