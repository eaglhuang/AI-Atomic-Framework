# recover-composer-non-fast-forward

- command: `git recover-push-fail`
- outcome: `composer-routed`
- lane: `deterministic-composer`
- verdict: `needs-physical-split`
- base commit: `5ea37e6ac3f8118c129299d3a0069b88369fa92c`
- local actor: `fixture-agent`
- remote virtual actor: `virtual:git-remote@84ed9bd9d66071f9677537493c8ffeb1129728b5`
- target files: data.json
- recommendation: Push rejection recovery reran admission after fetch and found a mergeable same-file conflict in data.json. Use git admit --steward-plan or --apply-to-working-tree, then validate and retry the push manually.
