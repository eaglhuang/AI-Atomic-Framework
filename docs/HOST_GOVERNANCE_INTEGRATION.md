# Integration with Host Governance

ATM is designed as a neutral operating layer. By default it guides agent behavior, records evidence, and lets `atm doctor` detect missing governance signals after the fact. It does not make commits impossible by itself.

Host repositories can choose stronger enforcement without changing ATM core contracts.

## Enforcement Layers

Use these layers in increasing strength:

| Layer | Purpose |
| --- | --- |
| README entry | Make the official `node atm.mjs next --json` route the first instruction an agent sees. |
| `atm doctor` | Detect missing runtime state, layout drift, and Git commits without matching ATM evidence. |
| Git hooks | Block local commits when the previous HEAD already bypassed ATM, and record staged-tree evidence for the new commit. |
| CI | Run the same `atm doctor --json` gate on pushed commits. |
| Branch protection | Require the CI gate before merging protected branches. |
| Review policy | Ask reviewers to inspect the ATM evidence paths linked by `doctor`, handoff summaries, and reports. |

## Git Evidence Boundary

`atm doctor` checks Git evidence only when both conditions are true:

- the repository is a real Git worktree;
- ATM has been adopted in that repository.

The check passes without blocking when a repository is not Git-backed, has not adopted ATM yet, or has no commits.

When the check applies, evidence can match the latest commit in either of these ways:

- `details.git.commitSha` equals the latest commit SHA;
- `details.git.treeSha` equals the governed tree identity and `details.git.parentCommitShas` equals the latest commit parents.

The tree-based form exists because local pre-commit hooks cannot know the future commit SHA before Git creates it.

## Recommended Host Setup

1. Bootstrap ATM in the repository.
2. Install the opt-in example from `examples/git-hooks-enforcement/`.
3. Add a CI step:

```bash
node atm.mjs doctor --json
```

4. Treat `ATM_DOCTOR_GIT_EVIDENCE_MISSING` as a blocking signal.
5. Keep host-specific policy in the host repository, not in ATM core.

This keeps ATM portable while letting stricter hosts turn advisory governance into an enforceable workflow.
