# 2026-10-31 v3 L1 Django 開發集時間線（W1）

prereg v3 設計草稿 §6.1／§11 W1 的 L1 開發集探勘。只呼叫 GitHub 公開 REST API（`gh api`），**0 個模型呼叫、0 token**。這是開發集，不是保留集；flask／requests 不在這次探勘範圍。

本檔在探勘**之前**寫好並 commit；探勘後只追加「探勘結果」一節，不改上面的宣告。

## 作者批准（文一，2026-10-31）

- **C**：PR 清單改成 Django 在一個固定 30 天時間窗內已合併的 PR，取代舊的 1,547 筆快照（`2026-10-09-hist-mining/data/django_pr_snapshot_raw.jsonl`，偏向開很久的 PR）。
- **A**：時間線不合理的 PR 主分析排除；敏感度分析補 `t_start = created_at − 乾淨 PR 的 dev_seconds 中位數`。實作成推導欄位（旗標＋補值），不刪資料。規則 id `A-v1-2026-10-31`，定義見 miner README。
- **B**：清單定好後，跑完整免費探勘。

## 時間窗（事先宣告的選法）

- 規則：**2026-10-01 00:00 UTC 之前、最近一個完整的 30 天時間窗**，以 `merged_at` 為準，半開區間。
- 結果：`[2026-09-01T00:00:00Z, 2026-10-01T00:00:00Z)`（9 月剛好 30 天）。
- 不和保留集重疊：
  - v3 保留集 repo 是 flask／requests，這次不探勘。miner 的 holdout guard 也會拒絕。
  - L2 的 six-pairs 保留組 g04／g06 用的是 SWE-bench Verified 的 Django instance。整份 inventory 用到的 PR 編號都 ≤ 16938（django__django-11141 … 16938），遠早於這個時間窗（窗內 PR 編號 ≥ 2 萬）。
  - 這個時間窗也不在任何 HIST-v2 保留集定義裡。

## 清單

- 指令（miner commit `6f27d0cae`，在 `benchmark-harness/v3-l1-timeline-miner/`）：
  `PYTHONPATH=src python3 -m v3_l1_miner list-window --repo django/django --since 2026-09-01T00:00:00Z --until 2026-10-01T00:00:00Z --out <本目錄>/data/pr_list.jsonl`
- 查詢字串（GitHub search，上界含）：`repo:django/django is:pr is:merged merged:2026-09-01T00:00:00Z..2026-09-30T23:59:59Z`
- 列出時間：**2026-10-31T14:22:31Z**（台北時間 2026-10-31 22:22）
- `total_count` 52，`incomplete_results` false，窗外丟棄 0 筆，1 次 API 呼叫。
- `data/pr_list.jsonl` SHA256 `9a429830c78dee311dd9ded0063e3ab78a5f0cad40fe80e58fa73fef6cf8dcef`；查詢的詮釋資料在 `data/pr_list.jsonl.listing.json`。
- 獨立交叉核對：另用 `GET /repos/django/django/pulls?state=closed&sort=updated&direction=desc` 翻頁 4 次，篩出 `merged_at` 在時間窗內的 PR，同樣是 52 筆、編號完全相同。
- 規模說明：這個時間窗只有 **52 個 PR**，比舊快照的 1,547 筆少很多。Django 每月約有 50 到 80 個 PR 經 GitHub 合併，8 月是 50 個。

## 探勘計畫（宣告）

- `PYTHONPATH=src python3 -m v3_l1_miner mine --repo django/django --snapshot <本目錄>/data/pr_list.jsonl --events --out <本目錄>/data/mine`
- `--events` 另抓 issue timeline 的 force-push 事件。它只當旗標，不單獨排除。
- 接著跑 `rederive --summary`：逐筆推導，再做資料集層的規則 A 補值，最後跑 `validate`。
- 可中斷續跑；box 還原後重跑同一個指令即可。原始輸出若超過 100 MB，就壓縮保存。
