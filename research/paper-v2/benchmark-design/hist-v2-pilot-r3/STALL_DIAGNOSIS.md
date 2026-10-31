# pilot-r3 停止原因診斷

日期：2026-10-30。這份筆記在封存的世代之外，沒有修改世代裡的任何檔案。

## 結果

- pilot-r3 在 1740 格中的第 577 格停下：`django_dev_16703_18055_django_db_models_sql_query.py__textual_merge_file__forward__100__s1`。
- 停止原因是 harness error：driver 等 writer 18055 結束超過 40 秒（以 monotonic 計）。
- 依 A10，這次 pilot 不通過。
- 前 576 格：A9 無效格 0，反例 0，錯誤終態 0，負控制 5/5 抓到，模型 token 0。

## 證據：是整台機器停住，不是 harness 邏輯

1. 失敗格的工作目錄留在 TMPDIR。兩個 writer 都在 23:16:09.39（台北時間）之前通過 barrier 並送出。
   - writer 18055 在 23:16:09.396 已寫完結果，終態 committed，lock_wait 0.009 ms。
   - 16703 的 apply-patch 工作檔建立於 23:16:09.385，之後沒有結果。
2. 格子開始時的 kernel monotonic 時間是 37343.2 秒。
   - dmesg 在 37489.04 秒記錄 systemd-udevd 被 watchdog 以 signal 6 終止。這通常發生在 VM 暫停後恢復時。
   - 兩者相差約 146 秒，和 TIMING 的結束時間（約 23:18:35）一致。
3. 整個 run 的 Δwall 和 Δmono 相同（958.757 秒）。所以 kvmclock 在暫停期間照常前進，A9 的時鐘漂移規則不會觸發。
4. 在同一台機器上把這一格重跑 5 次，每次約 0.9–1.0 秒，全部有效、committed。
5. 較早的 dmesg 有 virtio_balloon "Out of puff"，表示 host 端有記憶體壓力。

## 意義

- A9 只抓時鐘不一致和送出間隔。它抓不到「兩個時鐘一起前進的整機暫停」。
- 這次 harness 照設計 fail-closed。
- 要不要把這種暫停視為無效格（封存後重跑一次），需要對 prereg 另做修訂，由作者決定。這裡沒有改任何規則。
- 一個可能的修訂（未實作）：driver 加一條 heartbeat 執行緒，若 monotonic 相鄰取樣差 > 1 秒，就把該格記為 A9 無效。
