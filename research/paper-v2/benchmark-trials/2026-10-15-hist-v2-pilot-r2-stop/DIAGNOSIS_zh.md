# pilot-r2 第 747 格：為什麼停，以及那一組 2 與 1

這是診斷，不是論文結果。沒有重跑 pilot，沒有跑 A′、C、主跑或留出集。沒有勝出主張。

格子是 `django:dev:17554_18450:django/db/models/fields/related_descriptors.py`，臂 `textual_merge_file`，順序 reverse，間隔 500 ms，seed 0。同題同順序同間隔同 seed 的 steward 收下同一對 proposal，本體 sha256 相同，成功計數是 2；textual 的成功計數是 1，並被記成 `inconsistent`。執行器因此停止。封存沒有被覆蓋。

## 原因

這不是 replay 資料錯誤，不是分類器的 `R(S)` 錯誤，也不是兩條臂合成出不同位元組。

它是 harness v3 的時鐘量測，加上各寫入者各自重開 30 秒。一次牆鐘跳變落在 textual 第二個寫入者的到達 `time.sleep` 裡。臂仍把那次提交標成期限內 ack。評分器依預先登記的共用 `T_stop` 把它看成晚提交。兩筆記錄矛盾，所以是 `inconsistent:ack`。

分類器這條規則沒有判錯。預先登記 r7 §3.2 與 R6-D2 就是：時間終態已終了，而 ack 紀錄互相矛盾時，狀態是 `inconsistent`，不得算成功。錯在 harness 交出了那對矛盾紀錄。

## 證據

封存格子 `raw/cells/django_dev_17554_18450_django_db_models_fields_related_descriptors.py__textual_merge_file__reverse__500__s0/`。

| 觀察 | 值 |
|---|---|
| `job-17554.json` 與 `job-18450.json` 的 mtime 差 | 0.008 秒。父行程在同一瞬間送出兩個寫入者 |
| `barrier/ready-17554` 與 `ready-18450` 的 mtime 差 | 0.004 秒。兩個寫入者都通過 barrier |
| 18450 的 `arrival_delay_ms` | 506.531。排程睡眠不是 110 秒 |
| 17554 `first_submit` → 結果檔 | 11:10:20.709 到 11:10:20.790。鎖等待 0.005 ms，持鎖 2.8 ms |
| 18450 `first_submit` | 11:12:11.036，比 17554 晚 110.327 秒 |
| 18450 鎖等待／持鎖 | 0.025 ms／20.3 ms。`retries` 是 0 |
| 18450 結果檔 mtime | 11:12:11.644，距它的 `first_submit` 約 0.6 秒 |

`worker.py` 在 barrier 之後、`run_textual` 之前只有 `time.sleep(scheduled_delay_seconds(job))`。`run_textual` 的第一個動作才是 `open_first(time.time())`。110 秒不在 `git merge-file`、不在等鎖、也不在重試。它在那次睡眠的牆鐘讀數裡。

本體 sha256 `4eebe97c7539c93d75aad6070c09be042329218f85e55260ffc1005d58424274` 等於 replay v2 的 `allowed_bodies["17554,18450"]`，也等於同格 steward 寫出的檔案。兩條臂都 committed 了同一對 proposal。

steward 在睡眠之前就 `open_first`。同格 steward 兩個 `first_submit` 只差 0.006 秒，所以同一次牆鐘跳變不會把 steward 的起算點拆開。這就是位元組相同、成功計數卻是 2 與 1 的原因：textual 的第二個起算點被跳變推到共用窗口外面，steward 的起算點沒有。

把 18450 的時間戳沿同一段工作時長平移，讓 `first_submit` 只比 17554 晚排程的 506.5 ms，同一份本體兩筆都變成 `success`。決定 `inconsistent` 的是那個 110 秒的牆鐘差，不是位元組，也不是題目。

18450 自己的 `executable_seconds` 是 30。textual 與 file_lock 把 `item_stop` 設成自己的 `first_submit + 30`，所以晚到的寫入者仍提交，並自標 `acked-in-window`。評分器的 `T_stop` 是較早的 `first_submit + 30`。18450 的 rename 晚於這個 `T_stop`，調和終態是 `late-commit-after-timeout`／`rename-after-stop`，`acked` 是 false。接受紀錄因為 17554 有期限內 ack 而 `acked` 是 true。R6-D2 因此給 `inconsistent:ack`。執行器把這個狀態當成 counterexample，停在第 747 格。

這台 VM 沒有 systemd journal，不能點名是 NTP 還是暫停把牆鐘往前推了 110 秒。產物把不連續點釘在那一次 `time.sleep` 裡面。沒有把這次跳變再注入系統時鐘。

## 哪些 pilot-r2 數字受影響

受這次 bug 影響、不能當成觀察：

- 這一格的 `inconsistent`，以及 textual 的 `combined_success` 1。若起算點只差排程延遲，同一本體是兩筆 success。
- steward 與 textual 的 248／249。不相同的那一組就是這一格。位元組相同是真的，成功計數 2 與 1 是這次時鐘差造成的。
- 矩陣停在 747／1740。A′、C，以及這一題之後的 B，都沒有執行。這個提前停止是這個假 counterexample 造成的。

沒有被這次時鐘差改寫的部分：類別 A 的十題都跑完，而且那 600 格的 `first_submit` 差落在排程延遲附近，沒有第二個超過 100 秒的缺口。steward 與 textual 的 A 是 400／400、file_lock 是 251／400，不是這一格的產物。它們仍在這份被提前停止的 pilot 封存裡，paper 不引用這份封存。

## 建議

不要續跑這份封存，也不要改它的位元組。下一個 harness 版本再修 `PROPOSED_FIX.md` 的兩件事，然後才開新的 pilot generation。這次沒有重跑。
