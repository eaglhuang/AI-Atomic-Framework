# Plan 3.x / 4.x false-green evidence freeze

- Verdict: **remain-open**
- Window: 2026-08-09T18:32:28.121Z → 2026-08-09T19:11:12.322Z
- Raw receipt count: 12
- Rescue worktrees held: 23

## Command receipts

| id | exit | timeout | elapsed ms | combined digest |
|---|---:|---|---:|---|
| target-head | 0 | false | 50 | `sha256:56d1c09951afbeb843b865e6944e0ac453a48ecd6587f440bb1f9fcc332d3c4a` |
| origin-main-head | 0 | false | 46 | `sha256:fcc231c74f922d78e767bb4623d123e40d882e3d13c4eebe6f427e17a0c3ad4f` |
| planning-head | 0 | false | 44 | `sha256:26cf7f901670d4b0fc862b261a201e227cf9a566e3ab62ece6188ce53fb76b1a` |
| target-status-porcelain | 0 | false | 74 | `sha256:bd98102b58f48ed551876f65277033c22579b424ef67b7477437bec9b383d7e6` |
| planning-status-porcelain | 0 | false | 86 | `sha256:c3f880a4f3ece4616e477697d0ad287e5db3c84ce5c6e46c4463d0d91ff4e78d` |
| worktree-registry | 0 | false | 71 | `sha256:417890188ad929e1d39abfcaa92c42d1047603f0e20823d5692f16997beac504` |
| task-ledger-census | 0 | false | 9165 | `sha256:64bf680ca6e465e205777ef31632408eb07c421ed6a6e7bfd245c9b1ff4f0d0b` |
| protected-override-census | 0 | false | 2439 | `sha256:d4e46c1ee89586ddb4663ac5772126f41eadcf14be865942eb9bccad380b1ca2` |
| validate-test-facade | 0 | false | 273092 | `sha256:8dd5a74c03f6932ba60cdeb7f8cdc1e322a419be94c47ec58d25fe2086c07a02` |
| validate-module-boundaries | 0 | false | 522 | `sha256:eb37d9e12d94af7f80f39b8f8e2d957ba30c98b892cf7f44e1a526b61a147ef2` |
| validate-quick | 1 | false | 74835 | `sha256:b508b7631d8121e7e0c2e96ae4ab662fb3332735dabe2538741b03ff35cbc517` |
| validate-standard | 1 | false | 1963771 | `sha256:bf7a3c73223592c47449c6ffe9c6f65a47cfbcc715a79f7fa2f53685f5f1b10a` |

The JSON companion is authoritative for raw stdout/stderr. Non-zero and timeout receipts remain negative evidence; this artifact does not compute a completion verdict from them.
