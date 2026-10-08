# support-raw-r1 — harness 前 hot/cold 動機實驗（壓縮封存）

> **不是 RQ 證據。** 這些是 harness 建立之前的 hot/cold runs（v0.1.17、q180、scale、multiprocess、cold-queue、compare），只用來說明後來為什麼做論文 2.0 實驗。不可把這裡的數字當成論文結論或效能宣稱。

本目錄保持壓縮。兩個 tarball 各自合法、彼此獨立，各含一半 run 目錄。不要把解出的 `runs/` 提交進 git。

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `support-raw-r1-a.tgz` | 15,201,998 | `5bebae601975b72260355864aa055903275ec5a64f5e8573767bbae3979d40ee` |
| `support-raw-r1-b.tgz` | 15,776,518 | `89fa2469003e95d1a2092a5f5bf0a8c1a939c8b715841dda826f6d915b386323` |

## 驗證

```bash
cd research/paper-v2/archive/support-raw-r1
sha256sum -c SHA256SUMS
```

## 解出（僅本機檢視）

```bash
tar -xzf support-raw-r1-a.tgz && tar -xzf support-raw-r1-b.tgz
```

解出後得到 `runs/`。
