# composer-disjoint-records

- command: `git admit`
- outcome: `composer-routed`
- lane: `deterministic-composer`
- verdict: `needs-physical-split`
- base commit: `8200012eb7349393a19fc32af91298862f8b29d3`
- local actor: `fixture-agent`
- remote virtual actor: `virtual:git-remote@23aeeb08d07b4e23ef31256622d9fe3c5b92db1a`
- target files: data.json
- recommendation: Same-file but potentially mergeable work was detected in data.json; route through deterministic-composer before push.
