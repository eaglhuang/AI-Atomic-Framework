# Plan 3.x / 4.x false-green evidence freeze

- Verdict: **remain-open**
- Window: 2026-08-14T07:56:47.814Z → 2026-08-14T08:12:02.287Z
- Raw receipt count: 12
- Rescue worktrees: **unavailable** (0 observed)
- Rescue worktree source: Current Git worktree registry contains no ATM-rescue-* entries; the required historical 23-entry evidence-hold manifest is unavailable from this live source and remains a Wave 0 blocker.

## Command receipts

| id | exit | timeout | elapsed ms | combined digest |
|---|---:|---|---:|---|
| target-head | 0 | false | 36 | `sha256:9eda960585365e5da33204f4ccff1d14d001c5b777e59372e11cc7069a96af5a` |
| origin-main-head | 0 | false | 34 | `sha256:031b06f694f9a8f408aa30534790c91ce0259eb9b1ab98ce98ba02eddb01ff03` |
| planning-head | 0 | false | 33 | `sha256:6f9c0a13107b7fe2f897e4a34a19090720e7acabd3e279bd985421f99f9b907a` |
| target-status-porcelain | 0 | false | 76 | `sha256:adf02e8ccdd9d4c4ae90022ce8049808666b2cc01e2ce0899c6f2ae32ecdc8e2` |
| planning-status-porcelain | 0 | false | 72 | `sha256:a1142d33edc72d0c8244f0960a6fa86cefe001a8c5bbb9a637cc971bd0e2559c` |
| worktree-registry | 0 | false | 59 | `sha256:f8c0bb8e275b0d5760f354af7e00ff70e0aade4500ecb4657e60829e80021498` |
| task-ledger-census | 0 | false | 5077 | `sha256:4452e60816ba5be545faf505fa5dd0a19cd7e0b308211f3f6d8d24f616f3fc74` |
| protected-override-census | 0 | false | 1747 | `sha256:a838d9d261116e40bfcc159349b029d2f6611a8fa5e0bece5cff7cca0d10b7c1` |
| validate-test-facade | 0 | false | 14968 | `sha256:8dd5a74c03f6932ba60cdeb7f8cdc1e322a419be94c47ec58d25fe2086c07a02` |
| validate-module-boundaries | 0 | false | 290 | `sha256:73e57fdefc26a1336f0fac83ff9524b0ce25c337a0a88cf3a3567d68998eaad9` |
| validate-quick | 1 | false | 41720 | `sha256:18f5fae56abc4c08c0f7bddfe393c4b11cdf938dcc45a168d09c4e2533e84829` |
| validate-standard | 1 | false | 850356 | `sha256:b258bd388d1233a5751a73bdc368390623605a2ac95cfde53dcc26835ac5e52a` |

The JSON companion is authoritative for raw stdout/stderr. Non-zero and timeout receipts remain negative evidence; this artifact does not compute a completion verdict from them.
