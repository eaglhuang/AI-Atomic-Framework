# Plan 3.x / 4.x false-green evidence freeze

- Verdict: **remain-open**
- Window: 2026-08-14T05:04:29.791Z → 2026-08-14T05:19:34.257Z
- Raw receipt count: 12
- Rescue worktrees: **unavailable** (0 observed)
- Rescue worktree source: Current Git worktree registry contains no ATM-rescue-* entries; the required historical 23-entry evidence-hold manifest is unavailable from this live source and remains a Wave 0 blocker.

## Command receipts

| id | exit | timeout | elapsed ms | combined digest |
|---|---:|---|---:|---|
| target-head | 0 | false | 41 | `sha256:5f18bdc562890a8dcca368573a721d33c71c42deed6d8594661499018511db25` |
| origin-main-head | 0 | false | 33 | `sha256:031b06f694f9a8f408aa30534790c91ce0259eb9b1ab98ce98ba02eddb01ff03` |
| planning-head | 0 | false | 33 | `sha256:c0081370a52a0d8a8dd1c26e82b213f6e126baf0ee0ae37fbeeb141bb05a9f20` |
| target-status-porcelain | 0 | false | 82 | `sha256:bd5785f1161e3a864a74c81b6fbfb082d8bdc9dfc1381a16ca4200d07b2befb7` |
| planning-status-porcelain | 0 | false | 74 | `sha256:d15f6824df2967fb09c0e0dcfd206fd0fb62f3965697f586d9a031986e622567` |
| worktree-registry | 0 | false | 51 | `sha256:df7a4ca339cbcb7a54aa04a121721351f5c3a983215d8ce78b4ee78cad30f1b2` |
| task-ledger-census | 0 | false | 2325 | `sha256:c56232dd29c40426cf91ed59f4abeaff95bb31fd79452e94bda40555afe0006a` |
| protected-override-census | 0 | false | 1374 | `sha256:c2ecb27c37b8cacd4aa4db10f4c0099d3101ac01f3d47813362c7341fcd18c93` |
| validate-test-facade | 0 | false | 14521 | `sha256:8dd5a74c03f6932ba60cdeb7f8cdc1e322a419be94c47ec58d25fe2086c07a02` |
| validate-module-boundaries | 0 | false | 288 | `sha256:f59dbe1239c9069bbe1866414ee7e353c9db8cec9de8657517931ea8923970ba` |
| validate-quick | 1 | false | 41281 | `sha256:fe0a3ffc623c8b64b6a90503bb8bb4e808a5a30f1254dc5e6b8222ea6161f290` |
| validate-standard | 1 | false | 844358 | `sha256:a887883370b08a2938c14b9936fe45cc349571b49ac9924a5bf1c21e7d3325df` |

The JSON companion is authoritative for raw stdout/stderr. Non-zero and timeout receipts remain negative evidence; this artifact does not compute a completion verdict from them.
