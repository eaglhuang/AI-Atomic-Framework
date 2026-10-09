# 先前 generation 參照（r6 不重新打包 r1–r5 raw）

r6 的 analyze（`summaries/runs/r6-analysis/r6-2026-10-09/`）會讀 r1–r5 raw 做重評分與重建，讀的就是下列封存檔案（未修改）。r1–r5 的 `SHA256SUMS` 以 r5 封存時的值為準（見下表）；repo 端由 cloud agent 以各目錄 `verify.sh` 確認。

| generation | SHA256SUMS sha256 | 上傳包 |
|---|---|---|
| `generations/r1-reviewed-2026-10-07/`（274 檔） | `30d663c28f6c5a200988bb1e61a3c765408a43a668c5c575ee9aef8f0ced033f` | `paper-v2-r1-upload.tgz` sha256 `724a67508410063deed91437237c4de06e36581411f2d4e825433fe85e7ea9a6`，11,360,363 bytes |
| `generations/r2-2026-10-08/`（309 檔） | `25d4a2936b52623665f8351138d6c65c7393f8793b67bac46b84c3a272ac87fe` | `paper-v2-r2-upload.tgz` sha256 `75dea9633f9d7d825489a89b2655d594d8bd121e566988b819d2eb775c2e8697`，9,045,031 bytes |
| `generations/r3-2026-10-08/`（329 檔） | `7a8c0cb4e27960b9477f58323c46566bbbb4591009da9da9ebd919243cd869ed` | `paper-v2-r3-upload.tgz` sha256 `77dfdd744fb0d536944bfa2f62726395279fe86be2ad2a61cc0f7ad74c82411e`，22,094,044 bytes |
| `generations/r4-2026-10-08/`（363 檔） | `6aa0d178a32ee2b9df74679b2da4aa2575fd4bb10e8e4571418a18fffe81a7e7` | `paper-v2-r4-upload-part1.tgz` sha256 `84e20e444628d8ed787fb4b33ad61ce46e9fed14b9d14cec5020dabcb5aaf86e`，17,019,259 bytes；`paper-v2-r4-upload-part2.tgz` sha256 `0d89cece80afe7745e715c3b9f28c9860362e65814c33fdf36ff19ca5b6d14f1`，16,993,667 bytes |
| `generations/r5-2026-10-08/`（431 檔） | `2a4bfb184debaeb85a7283d990b92ba270732c344052497052761844f42a257a` | `paper-v2-r5-upload-part1.tgz` sha256 `86c46aa241a5d690f68e0abf8690aa748f8e5da129b5734f571a10ff25b206cf`，20,810,974 bytes；`part2` `f61c9148ada563f42a923c59bcd86d0aa9e79474165debb83644eff423301380`，21,127,149 bytes；`part3` `0aed6a8b406b91e2b0c0c97b5d7a2dac37e78166ce48c2e2f1a9952e353960e1`，12,384,566 bytes |

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
| `r3:raw/r3-matrix.tgz` | `47ca242c4a7ec230499383ff970c5c7f74048a96431d201079da732e84f6357d` |
| `r3:raw/r3-regression.tgz` | `1d8da8253fd80cad465acc7ce5b301fb3e2b022931773c0a22af3fc2ad39637e` |
| `r3:raw/r3-replay.tgz` | `02e4ea1e18ed5415a7ef7551a4f55200bf9ba971f55cb36b52bd4f5b5e85332a` |
| `r3:raw/r3-sp-noise-and-smoke.tgz` | `12c45bf9f6f94f0a7fb6b39c859b32f4dc7ff697e0379297e6605b60996b5bd9` |
| `r3:raw/r3-stdout.tgz` | `0d9e606c4b25cbdb206ce254640accdbabc2dae1223b609326c998380178a096` |
| `r4:raw/r4-matrix.tgz` | `caef94dfcc542c192195ae24bbe917978f0ba5b5b8e94f8deb3b730f6e3f3526` |
| `r4:raw/r4-regression.tgz` | `5ae39cc6ad38e90d1815373c6ca4bd1c05874632c478b69c9a130eaa5f38df4c` |
| `r4:raw/r4-replay-pins.tgz` | `a1511386bdf12c5fa0a9f5374502bfa38ce22d13767350ce4d4d9834f6bb6774` |
| `r4:raw/r4-replay-secondary-ablation.tgz` | `3ba5ad0fe8bf6883d7e47f17c657887310bb6c0a989302336b8a174ef849669b` |
| `r4:raw/r4-stdout.tgz` | `b5f90c04e59f3dbbf7de9d109c941e70560211d9d9200978eef2878dec98565d` |
| `r5:raw/r5-e5.tgz` | `0f622825e79ddac44955a7de34e8a5eb36076e29ab43bb2a140dae7642866141` |
| `r5:raw/r5-matrix.tgz` | `9a55b1b81bab0fa1a9b61f5b005b1f44a056e8782a3e967aa187c0eba4312dd9` |
| `r5:raw/r5-regression.tgz` | `0c0e4b78757add8b1120abe5639e3169c5b537ad0eea9bd6430964fdf7b18b28` |
| `r5:raw/r5-replay-main.tgz` | `4b27c57e867b73506b9adadbc6e1185609f1f6da0513f561c22079df8a28bfd2` |
| `r5:raw/r5-replay-recompose-ablation.tgz` | `6a8b03015e04a3b14d0136e66538cd4d3222cb80aeb44aef50c433df2c39a546` |
| `r5:raw/r5-stdout.tgz` | `bd0d989b35c76893a4f0605a606d60ffc21094a198c5102374fa570939f04fb5` |

不再攜帶，仍在先前 generation 內：
- `harness/R2_CHANGES.patch`–`R5_CHANGES.patch`；
- `summaries/runs/r5-analysis/r5-2026-10-08/`，由本 generation 的 r6-analysis 以同一管線從 raw 重算取代（其中含 `r3-compare/`、`r4-compare/`、`r5-compare/`；r5 replay／matrix 摘要與正式 r5 分析逐值相同）；
- r1–r5 raw。

驗證（皆唯讀）：
- r1 目錄：`bash verify.sh`。
- r2–r6 目錄：`sh verify.sh` 或 `bash verify.sh`。
