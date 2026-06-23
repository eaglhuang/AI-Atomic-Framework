# Git Boundary Paper Evidence

## Scope

- Deterministic fixture assertions: `tests/cli/git-admission-cli.test.ts` proves the scenario matrix is covered in repeatable local fixtures.
- Live CLI dogfood: this validator executes `atm.dev.mjs git admit` and `atm.dev.mjs git recover-push-fail` against ephemeral local Git remotes and records the resulting evidence envelopes.
- Limitation: all runs are local-hook / local-repo dogfood. They do not claim server-side enforcement.

## Live CLI Runs

| Scenario | Command | Outcome | Lane | Verdict | Target files | Base commit | Artifact paths |
| --- | --- | --- | --- | --- | --- | --- | --- |
| allow-remote-local-disjoint | `git admit` | `allow` | `direct-brokered` | `parallel-safe` | local-only.txt | `4fc5f3797aa8d97b57bfe5414c9828f0cf306708` | .atm/history/evidence/git-boundary-runs/origin-main-e5bc33c60ffb.json, .atm/history/evidence/git-boundary-runs/origin-main-e5bc33c60ffb.md |
| block-same-record-conflict | `git admit` | `block` | `blocked` | `blocked-cid-conflict` | data.json | `557a6e68b16922eef3133667546b211d21a22f7e` | .atm/history/evidence/git-boundary-runs/origin-main-efbf331bca95.json, .atm/history/evidence/git-boundary-runs/origin-main-efbf331bca95.md |
| composer-disjoint-records | `git admit` | `composer-routed` | `deterministic-composer` | `needs-physical-split` | data.json | `8200012eb7349393a19fc32af91298862f8b29d3` | .atm/history/evidence/git-boundary-runs/origin-main-ecd378eabc8c.json, .atm/history/evidence/git-boundary-runs/origin-main-ecd378eabc8c.md |
| recover-block-non-fast-forward | `git recover-push-fail` | `block` | `blocked` | `blocked-cid-conflict` | data.json | `d7e93343c2833f4a3ffb18889cf42cbf76f6f24f` | .atm/history/evidence/git-boundary-runs/origin-main-95792de4ecf6.json, .atm/history/evidence/git-boundary-runs/origin-main-95792de4ecf6.md |
| recover-composer-non-fast-forward | `git recover-push-fail` | `composer-routed` | `deterministic-composer` | `needs-physical-split` | data.json | `5ea37e6ac3f8118c129299d3a0069b88369fa92c` | .atm/history/evidence/git-boundary-runs/origin-main-9719ca69fc23.json, .atm/history/evidence/git-boundary-runs/origin-main-9719ca69fc23.md |

## Coverage

- `allow-remote-local-disjoint`: allow lane with no conflicting files.
- `block-same-record-conflict`: blocked run with conflicting mutation surface.
- `composer-disjoint-records`: composer-routed same-file mergeable case.
- `recover-block-non-fast-forward`: post-push-fail recovery that recommends rebase.
- `recover-composer-non-fast-forward`: post-push-fail recovery that recommends steward follow-up.

## Limitations

- MVP remains local-hook based and can be bypassed with local operator actions such as `--no-verify`.
- No server-side enforcement is claimed here; protected branches and CI remain separate deployment policy layers.
- Unsupported file types still fall back conservatively; absence of a format adapter should not be interpreted as semantic merge safety.
