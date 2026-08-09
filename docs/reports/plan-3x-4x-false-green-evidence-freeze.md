# Plan 3.x / 4.x false-green evidence freeze

- Verdict: **remain-open**
- Window: 2026-08-09T16:39:58.153Z → 2026-08-09T17:13:17.493Z
- Raw receipt count: 12
- Rescue worktrees held: 23

## Command receipts

| id | exit | timeout | elapsed ms | combined digest |
|---|---:|---|---:|---|
| target-head | 0 | false | 457 | `sha256:64960037089a32009bebee27c6079ef9688de2c9dc202f8bae807575f80754ac` |
| origin-main-head | 0 | false | 444 | `sha256:fcc231c74f922d78e767bb4623d123e40d882e3d13c4eebe6f427e17a0c3ad4f` |
| planning-head | 0 | false | 46 | `sha256:7612c2b4ba8cc1873b625147b4b7789f29dda9be820147091a839e9c3f916efd` |
| target-status-porcelain | 0 | false | 459 | `sha256:0fbc16523ae5e058db4c295765190c9438c489494870f6b084f6365d2446469b` |
| planning-status-porcelain | 0 | false | 512 | `sha256:a6d6e101c741d5799597c46b136d53df9cc9f0697e41f6d16341fe8a88d73feb` |
| worktree-registry | 0 | false | 452 | `sha256:00d1fbe441fb7aa952ccf4968d63bfe95151be29814d3124ae2a410d2531fc5a` |
| task-ledger-census | 0 | false | 8162 | `sha256:903ca178c1977a33317deaf277d4a5b19ff2d05de76dc3c8a59ea1bc9ecf4102` |
| protected-override-census | 0 | false | 6222 | `sha256:5bfd3e778d691a31792465ab494915941cf1fadf6390c3855ad308500e6f9659` |
| validate-test-facade | 0 | false | 230235 | `sha256:8dd5a74c03f6932ba60cdeb7f8cdc1e322a419be94c47ec58d25fe2086c07a02` |
| validate-module-boundaries | 0 | false | 357 | `sha256:f216256e2bee2d7038267f996ac4e3c1bf943cc4016f084080c38c249ff903f0` |
| validate-quick | 1 | false | 81221 | `sha256:e12e3773ae656832bf43af689d88969814bc1243a9e68b791e7fa406ab17fbec` |
| validate-standard | 1 | false | 1670769 | `sha256:0fb22158112d12cfa462b048a7f6e2b32b2908c8b692a2f3efc92d6294299e55` |

The JSON companion is authoritative for raw stdout/stderr. Non-zero and timeout receipts remain negative evidence; this artifact does not compute a completion verdict from them.
