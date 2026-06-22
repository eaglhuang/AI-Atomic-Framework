# Broker Evidence Bundle

- Scan at: 2026-06-22T03:26:49.016Z
- Total runs: 3
- Total tasks: 2

## Run Index
| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| registry-TASK-TEAM-BROKER-HOT-FIRST | TASK-TEAM-BROKER-HOT-FIRST | field | TASK-TEAM-BROKER-HOT-FIRST | coordinator-1 | broker-registry | direct-brokered:proposal-submitted | recorded:proposal-submitted | packages/cli/src/commands/broker.ts | intent-1782098808407 | 3fb7b2cdc6c8d40a77774b2c03c452b6e4a04213 | intent-1782098808407 | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqonm7vb-xido2dwc/.atm/runtime/write-broker.registry.json |
| steward-merge-37e2c6d6dab54d12 | merge-37e2c6d6dab54d12 | field | TASK-TEAM-BROKER-HOT-DISJOINT,TASK-TEAM-BROKER-HOT-FIRST | coordinator-1,coordinator-2 | steward.patch-apply | neutral-steward | mergeable | packages/cli/src/commands/broker.ts | proposal-hot-first,proposal-hot-second | 3fb7b2cdc6c8d40a77774b2c03c452b6e4a04213 | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqonm7vb-xido2dwc/.atm/runtime/proposal-gated-hot-apply.json |
| team-c46d91753531 | TASK-TEAM-BROKER-HOT-DISJOINT | field | TASK-TEAM-BROKER-HOT-DISJOINT | coordinator-2 | team-broker-lane | deterministic-composer:composer-routed | needs-physical-split:composer-routed | packages/cli/src/commands/broker.ts | n/a | 3fb7b2cdc6c8d40a77774b2c03c452b6e4a04213 | decision-1782098808496,txn-b7287f2a30ac91fb | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqonm7vb-xido2dwc/.atm/runtime/team-runs/team-c46d91753531.json |

## Task Artifact Index
| taskId | closurePacket | teamRuns |
| --- | --- | --- |
| TASK-TEAM-BROKER-HOT-DISJOINT | n/a | C:/Users/User/AI-Atomic-Framework/.atm-temp/atm-team-brokered-write-mqonm7vb-xido2dwc/.atm/runtime/team-runs/team-c46d91753531.json |
| TASK-TEAM-BROKER-HOT-FIRST | n/a | n/a |
