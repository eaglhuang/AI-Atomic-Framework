# Git Boundary Paper Evidence

This report is the final acceptance write-up for the Git-boundary evidence lane.

## Evidence model

- Deterministic fixture assertions live in `tests/cli/git-admission-cli.test.ts` and prove the scenario matrix remains reproducible in local Git fixtures.
- Live CLI dogfood artifacts are generated under `.atm/history/evidence/git-boundary-runs/` by `scripts/validate-git-boundary-paper-evidence.ts`.
- The paper-ready summary JSON is `.atm/history/evidence/git-boundary-runs/git-boundary-paper-evidence.json`.
- The human-readable bundle is `.atm/history/evidence/git-boundary-runs/git-boundary-paper-evidence.md`.

## Coverage summary

- `allow-remote-local-disjoint`: `git admit` returns `allow` for disjoint local and remote file changes.
- `block-same-record-conflict`: `git admit` returns `block` when local and remote mutate the same JSON record.
- `composer-disjoint-records`: `git admit` returns `composer-routed` for mergeable same-file disjoint record changes.
- `recover-block-non-fast-forward`: `recover-push-fail` reruns admission after a rejected push and recommends rebase for a true conflict.
- `recover-composer-non-fast-forward`: `recover-push-fail` reruns admission after a rejected push and recommends steward/composer follow-up for a mergeable same-file case.

## Deterministic fixtures vs live dogfood

- Deterministic fixtures:
  They guarantee the scenario matrix stays reproducible and are the safest way to assert specific outcomes in CI.
- Live CLI dogfood:
  The validator executes the real ATM CLI commands against ephemeral local Git remotes, captures the resulting evidence envelopes, and writes artifact paths that can be cited in review.

This distinction matters because fixture assertions prove contract stability, while live CLI dogfood proves the operator-facing command surface still emits the expected evidence model end to end.

## Limitations

- The MVP is still local-hook based and can be bypassed locally with operator actions such as `--no-verify`.
- These runs do not claim server-side enforcement. Protected branches, CI gates, and remote policy remain separate deployment controls.
- Unsupported file types still fall back conservatively; absence of an adapter should not be treated as semantic merge approval.
