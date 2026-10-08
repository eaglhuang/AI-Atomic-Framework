# 先前 generation 參照（r3 不重新打包 r1／r2 raw）

r3 的 analyze（`summaries/runs/r3-analysis/r3-2026-10-08/`）重評分與重建所讀的 r1／r2 raw，就是下列封存檔案（未修改）。

| generation | SHA256SUMS sha256 | 上傳包 |
|---|---|---|
| `generations/r1-reviewed-2026-10-07/`（274 檔） | `30d663c28f6c5a200988bb1e61a3c765408a43a668c5c575ee9aef8f0ced033f` | `paper-v2-r1-upload.tgz` sha256 `724a67508410063deed91437237c4de06e36581411f2d4e825433fe85e7ea9a6`，11,360,363 bytes |
| `generations/r2-2026-10-08/`（309 檔） | `25d4a2936b52623665f8351138d6c65c7393f8793b67bac46b84c3a272ac87fe` | `paper-v2-r2-upload.tgz` sha256 `75dea9633f9d7d825489a89b2655d594d8bd121e566988b819d2eb775c2e8697`，9,045,031 bytes |

| 路徑 | sha256 |
|---|---|
| `r1:raw/b-probes.tgz` | `55f67997bfbd81584ba3f862aa9a75e5aeb0f39f3fdeef02069b8e1062c872ad` |
| `r1:raw/c.tgz` | `4357bf1830557e55560177e629d00e91d220dd313f1a8965deec69451c20f535` |
| `r1:raw/d.tgz` | `b2e1a144ec4ac95c34d02746b3a2ad37598d42d9e4ee37ce4078f38cf7a3b79c` |
| `r1:raw/e1.tgz` | `efc3b19f09f5e4bb5e1821962eece5f48d9233b6d9e1e345607ac40f0d007168` |
| `r1:raw/e2.tgz` | `25e648e2681abdddc279d060f1ddae8df090ee83213f7fb165aafbdcc5eee355` |
| `r1:raw/e3.tgz` | `1fed09dba2639d64d29dfee4637b204f920e4cb926e3062d59fdd60853727a1f` |
| `r1:raw/e4.tgz` | `b9c79193c2a4f077cfb2118d59f4946f3d670aa0acad431dce0ff8d0c692458f` |
| `r1:raw/e5.tgz` | `ea5a3492ffe5ae4150ea71c70d62954a7f39d7d33b87997ff12bb518f24603b7` |
| `r1:raw/gaps.tgz` | `98a22e1ada9df196044269bf0a50c094629d48436c4f5569d57110427e01252c` |
| `r1:raw/steward.tgz` | `a350d3facc1c2039b304bceb4fe1a6997409da7523ae649ecafd192a57d0db8a` |
| `r2:raw/r2-e4-forensics.tgz` | `dcabd78b8136622deea92e27de9ac2063bd8f9c7fd8d306e5f786fed358bab62` |
| `r2:raw/r2-smoke.tgz` | `06f54986b642a4cba1f3d01bd7f4ce2bbb6a4596af77761498f1f8bcfeb4399b` |

不再攜帶（仍在 r2 generation 內）：`harness/R2_CHANGES.patch`（r1→r2 diff）、`summaries/runs/r2-analysis/r2-2026-10-08/`（由本 generation 的 r3-analysis 以同一管線從 raw 重算取代）。

驗證：r1 目錄 `bash verify.sh`；r2、r3 目錄 `sh verify.sh` 或 `bash verify.sh`（皆唯讀）。
