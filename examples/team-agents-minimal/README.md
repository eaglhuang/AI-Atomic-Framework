# Minimal Team Agents Example

This example shows the smallest governed Team Agents packet for a first task.

Run:

```shell
node atm.mjs team plan --task TASK-EXAMPLE-TEAM-0001 --team-size L1 --json
node atm.mjs team validate --task TASK-EXAMPLE-TEAM-0001 --json
node atm.mjs team start --task TASK-EXAMPLE-TEAM-0001 --actor coordinator --team-size L1 --json
```

Artifacts in this folder are examples only. Workers do not self-close, self-commit, or bypass the Coordinator.
