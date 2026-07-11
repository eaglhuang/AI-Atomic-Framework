# Quick Start Walkthrough

Goal: complete the first Team Agents dry run within 90 minutes.

1. Pick a narrow task with one write scope.
2. Run `team plan --team-size L1`.
3. Run `team validate`.
4. Run `team start` without `--execute`.
5. Collect validator output.
6. Let Coordinator close only after required evidence exists.

Expected result:

- Runtime state is written.
- No worker self-commits.
- Governance fields are visible in plan/status output.
