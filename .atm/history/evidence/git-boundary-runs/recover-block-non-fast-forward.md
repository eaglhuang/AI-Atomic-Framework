# recover-block-non-fast-forward

- command: `git recover-push-fail`
- outcome: `block`
- lane: `blocked`
- verdict: `blocked-cid-conflict`
- base commit: `d7e93343c2833f4a3ffb18889cf42cbf76f6f24f`
- local actor: `fixture-agent`
- remote virtual actor: `virtual:git-remote@03b4de790695e8e8ee4537dcc2c7f950d1599e94`
- target files: data.json
- recommendation: Push rejection likely came from a non-fast-forward remote change. Rebase or otherwise replay your local commits on top of the refreshed remote branch before retrying push. Conflicting mutation surfaces were detected in data.json; rebase, split the work, or rearbitrate before push.
