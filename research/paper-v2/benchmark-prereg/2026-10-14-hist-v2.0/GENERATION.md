# HIST-v2 預先登記 v2.0（方法設計凍結）

日期：2026-10-14。這是不可變目錄。凍結範圍**只有方法設計**。不是分類證據，不是實驗證據，沒有 run，不宣稱勝出。

## 審閱結論

外部靜態審閱 main `f08599c7d864cd4ede0b50e4c6b6742b4a892f0b`（設計稿 r7＋分類器 v7）的結論是：**方法設計可以凍結**。

同一審閱要求：分類器 v7 **還不能**用來產生正式分類或實驗證據。v7 的 `RULES.md` 在該 commit 的 SHA-256 是 `4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0`。本目錄建立時已在目前 main（同一個完整 SHA）核對，雜湊相符。

## 凍結了什麼

自 `research/paper-v2/benchmark-design/2026-10-11-hist-bench-v2-r7/` 原樣帶入，位元組不變：

- `HIST_BENCH_V2_PREREG_r7_zh.md`
- `DECISIONS.md`（R2-D1～R7-D1 全部帶入）
- `README.md`（r7 當時的草稿說明；那份文字裡的「尚未凍結」描述的是來源稿，不是本目錄的狀態）

本目錄的狀態以這份 `GENERATION.md` 為準：方法設計已凍結。來源檔內部的草稿字句保留，不改寫。

## 還沒開放的准入

分類與實驗仍然有閘門，這次沒有跨過：

- 不得用分類器 v7 產出正式分類或實驗證據。
- 不得跑基準臂、冒煙、pilot 或主跑。
- 真實 harness 還要另外接上：`combined_success`、實際接受集合 S 與 R(S)、錯誤對逾時、停止／對帳、雙程序屏障、負控制、統計。
- ATM core 跨寫入者的共用 compose inbox（草稿 PR #269）仍另案追蹤。

這些是後續閘門，不在這次凍結裡。

## 釘選

| 項目 | 值 |
|---|---|
| 來源 commit（完整 SHA） | `f08599c7d864cd4ede0b50e4c6b6742b4a892f0b` |
| r7 `DECISIONS.md` sha256 | `e6fd756c5d48f77a242691c6a4fc62ca34ed53ccd37c4162cd994e7190c38ee8` |
| r7 `HIST_BENCH_V2_PREREG_r7_zh.md` sha256 | `a4030f9b7606ae724aaf89b8e9d6186759ab146869632d9def3bb2b6df6a3a55` |
| r7 `README.md` sha256 | `21bd33c54c017b5355674d7716ec90fb0b5a45b3861d8cf37858e21424221d70` |
| r7 `DECISIONS.md` git blob | `a225d83c6e6e965d691b8b03e3de4f969841463c` |
| r7 `HIST_BENCH_V2_PREREG_r7_zh.md` git blob | `efd7d87c28f3caa32599d0557ddc2e419249c4af` |
| r7 `README.md` git blob | `6a5d135f497415864bae2fe9e53a72b1435298d9` |
| 分類器 v7 `RULES.md` sha256 | `4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0` |
| 分類器 v7 `RULES.md` git blob | `c82c6fc691ad06f04cfbb21f4186ad76888346f2` |
| jsonschema | `4.18.0`（分類器契約；本目錄不執行分類） |

驗證（唯讀）：`sh verify.sh`。封印後不得改本目錄任何檔。
