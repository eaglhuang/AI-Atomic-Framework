pilot — 不得作為論文結果

日期：2026-10-15
這份報告只列計數。它不是論文結果，也不比較臂的優劣。
區間：未計算。pilot 停在計數，不估計比較區間，不進正式結果。

## 抽題

- 抽中題數：29
- 缺的類別：B'、D
- 拒絕的留出列：213
- 計畫格子：1740
- 已執行格子：1740

## 每臂每類別

| 臂 | 類別 | 格子數 | combined_success 計數 | proposal 計數 |
|---|---|---:|---:|---:|
| file_lock | A | 200 | 250 | 400 |
| file_lock | A' | 160 | 160 | 320 |
| file_lock | B | 200 | 221 | 400 |
| file_lock | C | 20 | 20 | 40 |
| steward | A | 200 | 300 | 400 |
| steward | A' | 160 | 320 | 320 |
| steward | B | 200 | 200 | 400 |
| steward | C | 20 | 20 | 40 |
| textual_merge_file | A | 200 | 300 | 400 |
| textual_merge_file | A' | 160 | 320 | 320 |
| textual_merge_file | B | 200 | 200 | 400 |
| textual_merge_file | C | 20 | 20 | 40 |

## batch size 分布

| 值 | 計數 |
|---|---:|
| 0 | 829 |
| 1 | 1491 |
| 2 | 1160 |

## 終態分布

| 值 | 計數 |
|---|---:|
| committed | 2331 |
| error | 600 |
| rejected-conflict | 549 |

## 負控制

全部被抓到：true

| 控制 | caught_as | combined_success | 抓到 |
|---|---|---|---|
| lost-accepted-proposal | bytes-do-not-match-R(S) | false | true |
| partial-apply | bytes-do-not-match-R(S) | false | true |
| bytes-do-not-match-R(S) | bytes-do-not-match-R(S) | false | true |
| illegal-subset | illegal-set | false | true |
| late-write-after-timeout | late-commit-after-timeout | false | true |

## counterexample

沒有。

## 偏離

- 凍結 r7 §8 只寫 pilot 在使用者明確同意後才跑、試跑、不進正式結果，沒有密封題數。作者於 2026-10-15 15:19（Asia/Taipei）批准 about 30 groups。runbook 把它操作成：只抽 set=dev、恰好兩份 proposal、每個 write_class 依 project 與 id 排序後最多 10 題，類別順序 A、B、C、A′、B′、D，合計上限 30。沒有改預先登記。留出集不抽。
- 封存的 harness v2 沒有實作預先登記 §9 的均勻抖動（0～min(10 ms, 間隔的 10%)，由 seed 決定）。本次不改 harness 位元組，間隔用名義值 0／50／100／500／2000 ms。這不是用 pilot 回改預先登記。

## 臂與預先登記的對應

凍結預先登記 r7 §3.1 與 §7 的主比較是三條臂，不是四條。§3 所說的 ATM 臂是 steward：候選由 ATM 批次協調器合成，協調器與 SQLite 的耗時計入 30 秒。它不是 harness 裡另外一條名叫 atm 的臂，也不是舊長矩陣裡的「完整 ATM」。bare_composer 不在主比較裡。occ 與 git 三方收成 textual_merge_file 這一條，不拆開。本次 pilot 只跑下面三條。

| 臂 | 預先登記角色 |
|---|---|
| steward | 處置。ATM 批次協調器的合成。base 是協調器綁定的不可變 base。整檔鎖與其他臂相同。第一次送出後 8 次重試。 |
| file_lock | 對照。鎖內讀改寫該 proposal 的 hunk，不用 git merge-file。base 是鎖內讀到的檔案。同一把整檔鎖持有到原子替換結束。 |
| textual_merge_file | 對照。鎖外用 git merge-file，不用 --union／--ours／--theirs。鎖內 base 變了就作廢並在鎖內重算，計入 8 次重試。 |
| atm | 不跑。harness v2 另有這條臂。它不在 §3.1 與 §7 的三條主比較裡。 |


## 值得注意

- 抽題上限來自作者 2026-10-15 15:19（Asia/Taipei）批准的 about 30 groups，不是凍結正文裡的密封題數。見偏離。
- 2026-10-15 smoke 裡 file_lock 的 combined_success 計數與另外三條臂不同：A′ 是 4／8，atm、steward、textual_merge_file 是 8／8；B 是 7／8，另外三條臂是 4／8。那次 smoke 含 harness 的 atm 臂。本次 pilot 不跑 atm。沒有用那個差異修改預先登記。
- 本次類別 A：file_lock 的 combined_success 是 250／400，同題其他臂是 300／400。這是計數。
- 本次類別 A'：file_lock 的 combined_success 是 160／320，同題其他臂是 320／320。這是計數。
- 本次類別 B：file_lock 的 combined_success 是 221／400，同題其他臂是 200／400。這是計數。

## 建議

偏離寫在上一節。由作者決定。不要把它們當成臂的優劣。

沒有勝出主張。
