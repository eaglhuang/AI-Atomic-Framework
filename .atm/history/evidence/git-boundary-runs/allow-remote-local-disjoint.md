# allow-remote-local-disjoint

- command: `git admit`
- outcome: `allow`
- lane: `direct-brokered`
- verdict: `parallel-safe`
- base commit: `4fc5f3797aa8d97b57bfe5414c9828f0cf306708`
- local actor: `fixture-agent`
- remote virtual actor: `virtual:git-remote@bb2d588bc621f85fdd8f9e5443f171a783772fb3`
- target files: local-only.txt
- recommendation: Admission passed; you can proceed to push or capture this verdict as hook/CI evidence.
