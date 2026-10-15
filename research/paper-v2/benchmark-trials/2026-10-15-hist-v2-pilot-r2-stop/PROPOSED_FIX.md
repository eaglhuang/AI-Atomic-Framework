# 建議的修正（未套用，沒有重跑）

不改 harness v3 的位元組。下一個 harness 版本再做。這份文件不是那個版本。

## 1. 到達延遲用單調時鐘錨定

`worker.py` 現在是 barrier 之後 `time.sleep`，然後 `run_textual`／`run_file_lock` 才 `open_first(time.time())`。睡眠期間的牆鐘跳變會把 `first_submit` 往後推。

建議：barrier 放開時記下 `time.monotonic()` 與 `time.time()`。延遲仍睡單調時鐘上的那一段。`first_submit` 用「錨定的牆鐘 + 已經過去的單調秒數」，不要在睡眠結束後再讀一次 `time.time()`。排程延遲仍是 `order_index * interval + §9 jitter`。

steward 已經在睡眠前記下 `first_submit`。textual 與 file_lock 要和它對齊，否則同一次跳變只拆其中一邊。

## 2. 共用 T_stop

預先登記 §3.2：任一 proposal 的 30 秒到期，該題所有寫入者都停。有效停止時刻是 `min(自己的第一次送出 + 30 秒, T_stop)`。晚送出的 proposal 不另得 30 秒。

現在 textual 與 file_lock 把 `item_stop` 設成自己的 `first_submit + 30`，所以牆鐘上已經超過共用窗口仍會 rename，並自標 `acked-in-window`。評分器用較早的 `first_submit + 30`，於是臂的 ack 紀錄和調和終態矛盾，變成 `inconsistent`。

建議：寫入者共用同一個 `T_stop`（最早的 `first_submit + 30`）。超過它就不要開始新的提交，也不要把晚的 rename 標成 `acked-in-window`。這樣評分器與臂使用同一組時間，R6-D2 不會因為 harness 自己的兩套時鐘而停跑。

間隔在 2 秒以內時，這兩套時鐘通常給出相同的成功計數。這次是牆鐘跳了 110 秒才分開。修正仍要做，因為預先登記寫的是共用停止，不是每個人各開 30 秒。

## 不要做的事

不要續跑 `2026-10-15-hist-v2-pilot-r2/`。不要為了驗證這個修正去跑 A′、C、主跑或留出集。新的 pilot 是下一個 generation 的事。
