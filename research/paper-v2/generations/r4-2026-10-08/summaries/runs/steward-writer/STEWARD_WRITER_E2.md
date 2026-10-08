# STEWARD_WRITER_E2 — Main matrix chronicle

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 22:56 CST（Asia/Taipei） |
| Checklist | **E2** |
| ATM | pin `5692474f…` 唯讀；未改 ATM 源碼、未 publish、未打 tag |
| Main | `--arm steward`（D5 `MAIN_METHOD_INVOCATION`） |
| 產出 | `runs/e2-matrix/`（SEEDS_REGISTERED／seeds.json／run_matrix／e2_compare_raw／E2_SUMMARY）；150 cell dirs；2 diag |

## 做了什麼

1. **跑前**寫入 `SEEDS_REGISTERED.md`＋`seeds.json`（10 workload seeds；`scheduler = workload + 1000`）。
2. Harness 新增 `--scheduler-seed`：結構用 workload seed；hold/jitter 用 scheduler 覆寫（同 wl seed 結構可比）。
3. 跑滿 3×5×10＝**150** 主格＋2 診斷；agents×trials 維持 **3×5**（E1 parity；文件化）。
4. 抽 correct／lost／blocked／offered／eligible／rate／coverage／goodput／p50–p99／cas_retry／repropose；配對 hash 30/30；seed≠ 150/150。
5. 更新 checklist／VERSION_ANCHORS／ARTIFACT_PACK_SPEC；**不**自動開 E3。

## 通過判準

- Seed registry 早於 runs → **是**
- 矩陣完成＋E2_SUMMARY 含必要指標 → **是**
- 無 ATM 改動／無 win claim 措辭 → **是** → **E2 done**

## 重跑單格範例

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
node src/cli.mjs start --run-id e2-hot_conflict-steward-s11 --arm steward --atm-backend real \
  --compose-window-ms 100 --seed 11 --scheduler-seed 1011 --agents 3 --trials 5 \
  --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force
```

