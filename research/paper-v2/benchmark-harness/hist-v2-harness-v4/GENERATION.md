# HIST-v2 harness v4

日期：2026-10-30。這是 harness 接線，不是實驗證據。v3 目錄的位元組不在這裡修改。預先登記 v2.0 目錄沒有改。依據是 pilot-r2 根因分析與預先登記 v2.1 修訂草案 A8／A9（尚待凍結）。

## 為什麼有 v4

pilot-r2 停在第 748 格（`disjoint-ordering-bias-pr10-pr11`，steward，種子 1，reverse，間隔 0），分類器給 `inconsistent`。根因有兩個，都在 harness，不在分類器：

1. v3 每條臂以「自己的第一次送出 + 30 秒」為停止點，沒有實作預先登記 §3.2 的共同 item T_stop。分類器 v8 用 `min(自己的期限, item T_stop)`，兩邊定義不同。
2. v3 用 `time.time()`。那一格裡兩個寫入者的牆鐘第一次送出相差約 110 秒，而設計延遲是 0，這是主機牆鐘跳動，不是排程。

## 相對 v3 的改動

1. **單調時鐘（A8）。** 期限算術一律用 `CLOCK_MONOTONIC`（`clock.MonotonicClock.now()`）。Linux 上它是全系統共用，同一次開機的不同寫入行程可以互相比較。`time.time()` 只當記錄用的標籤。
2. **共同 item T_stop（A8，§3.2 L96-98）。** 每個寫入者第一次送出後，把單調時間寫進 `<workspace>/item-clock/submit-<id>`（暫存檔 + rename）。每次停止檢查（拿鎖前、重試前、rename 的暫存寫入前後）都重讀這個目錄，T_stop = 已發布的最早第一次送出 + 30 秒。晚到的寫入者繼承較早寫入者的 T_stop，不會拿到新的 30 秒。已過期就直接記 `timeout`。
3. **單一停止函式（A8）。** `deadline.effective_stop` 與 `timeout_reason` 直接呼叫分類器 v8 的 `reconcile_terminal`，所以臂與評分器用同一個定義：`min(自己的第一次送出 + 30, T_stop)`；T_stop 較早時原因是 `item-stop`，否則是 `own-deadline`。`scoring.stop_agreement` 逐 proposal 比對臂實際執行的停止點與評分器的停止點。
4. **雙時鐘記錄（A8）。** 每個 `WriterResult` 多一個 `clocks` 欄位：`barrier_exit`、`submit`、`rename`、`ack` 的 `{mono, wall}`，以及該寫入者最後看到的 `item_stop`、`own_deadline`、`effective_stop`。driver 另記 `cell_start`／`cell_end`。
5. **時鐘不連續作廢規則（A9）。** `validity.cell_validity` 合併一格內所有雙時鐘戳記：任兩點之間 |Δ牆鐘 − Δ單調| > 1 秒，或觀察到的送出間隔（任一時鐘）超出設計間隔 1 秒以上，該格標成 `environment-invalid:clock-discontinuity`。這條規則只讀時鐘，不讀結果。作廢格要封存、列出、不進任何計數，由 stage runner 以相同種子／順序／間隔重跑一次；第二次又作廢是 harness 失敗；作廢比例超過計畫格 1% 時整個 stage 停止（`stage_should_stop`）。
6. **steward 的第一次送出。** v3 在 barrier 之前就開始計時，並把 `arrived_at` 設成「開始計時 + 設計延遲」。v4 的第一次送出是 barrier 與設計延遲之後寫 inbox 的那一刻，`arrived_at` 就是那個單調時間。v3 在 rename 被拒時仍把整批成員寫成接受或衝突；v4 這時把成員寫成 `timeout`，原因依各成員自己的第一次送出計算。
7. **driver。** 子行程逾時（40 秒）會停掉同一格的所有寫入者，並以 `RuntimeError` 回報，不留下孤兒行程。
8. **固定 hunk 套用器。** v2／v3 的 `node/apply-patch.ts` 直接 import 現行 `packages/core/src/broker/unified-patch.ts`。core 在 2026-10-20（a7dd5da6e7 起）加了 offset locator，之後歷史 hunk 在位移後也能套上：已知題 `django:dev:15705_16703` 的 file_lock 臂從 `rejected-conflict` 變成 `committed`，v3 今天重跑也一樣。pilot-r2（10-15）不受影響。file_lock、steward 的 mine 推導與 `legal.py` 的合法子集都走這個套用器，所以 v4 把 CORE_MERGE `cb25242433` 版本逐位元組放進 `node/pinned/unified-patch.cb252424.ts`（無 import），`apply-patch.ts` 改 import 這份。`atm` 臂的 `shared-compose-inbox.ts` 從 cb25242433 起沒有改動，仍 import 現行 core。
9. **測試掛勾。** `run_fixture(..., test_wall_jump_s={order_index: 秒})` 只在測試使用：在指定寫入者通過 barrier 後，讓它的牆鐘標籤跳動，單調時鐘不變。正式執行一律不帶這個參數。

`atm` 臂沒有改：它的期限在 `packages/core` 的 coordinator 裡，不在這個 harness。v4 把它列為探索臂，不計算它的 validity，pilot-r3 也不跑它。

## 測試（`tests/test_v4_clock.py`，不呼叫模型）

- `effective_stop`／`timeout_reason` 與 `reconcile_terminal` 一致。
- 晚到的寫入者（T_stop 已由別人在 100 秒時開始，自己在 131 秒送出）：textual 與 file_lock 都記 `timeout`／`item-stop`，沒有 rename，檔案仍是 base。
- 等鎖期間越過別人的 T_stop（120 秒送出、等到 131 秒）：rename 被拒，`item-stop`。
- 牆鐘跳 110 秒、單調不變：判定與不跳時相同，validity 標成作廢（單行程與多行程各一）。
- 送出間隔超出設計 1 秒以上會作廢；1% 停止門檻。
- 模擬 agent 乾跑：catalog 六個 fixture × 三條比較臂 × 間隔 0／500，全部有效、全部共用同一個 T_stop、臂與評分器的停止點一致。

`tests/test_v4_pinned_applier.py`：`apply-patch.ts` 只 import 固定副本；固定副本的 sha256；本地有 cb25242433 歷史時與 `git show` 位元組相同。

v3 的測試全部保留並通過。

## 依賴

與 v3 相同：預先登記 `2026-10-14-hist-v2.0`、分類器 v8 `RULES.md` sha256 `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541`、ATM core compose inbox merge `cb25242433882d34b514b79338d1a00def53a875`、jsonschema `4.18.0`。

## 還沒做的事

修訂 A8／A9 尚未凍結。這個 harness 只能產生 pilot 世代的資料，不是正式證據。
