# r1 參照（r2 不重新打包 r1 raw）

r2 的重評分、重建與 E4 鑑識所讀的 r1 raw，就是下列 sealed r1 檔案（未修改）。

- r1 generation：`research/paper-v2/generations/r1-reviewed-2026-10-07/`（274 檔）
- r1 `SHA256SUMS` sha256：`30d663c28f6c5a200988bb1e61a3c765408a43a668c5c575ee9aef8f0ced033f`
- r1 上傳包 `paper-v2-r1-upload.tgz`：sha256 `724a6750…`，11,360,363 bytes

| r1 路徑 | sha256 |
|---|---|
| `raw/b-probes.tgz` | `55f67997bfbd81584ba3f862aa9a75e5aeb0f39f3fdeef02069b8e1062c872ad` |
| `raw/c.tgz` | `4357bf1830557e55560177e629d00e91d220dd313f1a8965deec69451c20f535` |
| `raw/d.tgz` | `b2e1a144ec4ac95c34d02746b3a2ad37598d42d9e4ee37ce4078f38cf7a3b79c` |
| `raw/e1.tgz` | `efc3b19f09f5e4bb5e1821962eece5f48d9233b6d9e1e345607ac40f0d007168` |
| `raw/e2.tgz` | `25e648e2681abdddc279d060f1ddae8df090ee83213f7fb165aafbdcc5eee355` |
| `raw/e3.tgz` | `1fed09dba2639d64d29dfee4637b204f920e4cb926e3062d59fdd60853727a1f` |
| `raw/e4.tgz` | `b9c79193c2a4f077cfb2118d59f4946f3d670aa0acad431dce0ff8d0c692458f` |
| `raw/e5.tgz` | `ea5a3492ffe5ae4150ea71c70d62954a7f39d7d33b87997ff12bb518f24603b7` |
| `raw/gaps.tgz` | `98a22e1ada9df196044269bf0a50c094629d48436c4f5569d57110427e01252c` |
| `raw/steward.tgz` | `a350d3facc1c2039b304bceb4fe1a6997409da7523ae649ecafd192a57d0db8a` |
| `review/EXTERNAL_REVIEW_2026-10-07.md` | `64288fe57a77bef5f98c4125f9ebf376f0da110f68ec266132f84784cff82353` |
| `review/REVIEW_PACK_FOR_EXTERNAL_AI.md` | `2db32e0e9e6bb415a532556008293e730dbfca08b160510bf1285f1a3f94e6e5` |
| `review/review-pack.tgz` | `c9a98cc843528e9b3cd406cacc79c7fef71531a1f404da9bde48683e72ca8fab` |

驗證方式：在 r1 generation 目錄執行 `sh verify.sh`（唯讀），再比對上表。
