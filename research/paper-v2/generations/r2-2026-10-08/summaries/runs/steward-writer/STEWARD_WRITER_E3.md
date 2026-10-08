# STEWARD_WRITER_E3 — Window／batch sweep chronicle

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 23:17 CST（Asia/Taipei） |
| Checklist | **E3** |
| ATM | pin `5692474f…` 唯讀；未改 ATM、未 publish、未打 tag |
| Main | `--arm steward`；對照 `bare_composer`（hot_conflict only） |
| 產出 | `runs/e3-sweep/`（SEEDS_REGISTERED／seeds.json／run_sweep／e3_compare_raw／E3_SUMMARY）；120 cell dirs |

## 做了什麼

1. **跑前**寫入 `SEEDS_REGISTERED.md`＋`seeds.json`（5 wl seeds；`scheduler=wl+1000`；window 格 0/25/50/100/200/400）。
2. 跑滿 **120** cells：steward 3 wl × 6 windows × 5 seeds＝90；bare_composer hot_conflict × 6 × 5＝30。
3. 抽 A2 指標：correct／eligible／offered／goodput／admit·total p50–p99／window_wait／batch_size／cas_retry／repropose。
4. 強調 **latency vs coverage／goodput**；steward 本規模下 rate 維持 1.0，tradeoff 主顯於 wall／goodput／window_wait（bare 在 w>0 出現 blocked）。
5. 更新 checklist／anchors／pack；**不**自動開 E4。

## 通過判準

- Seed registry 早於 runs → **是**
- 含 window=0 → **是**
- E3_SUMMARY＋compare JSON → **是**
- 無 ATM 改動／無 win claim → **是** → **E3 done**

## 重跑單格範例

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
node src/cli.mjs start --run-id e3-hot_conflict-steward-w0-s11 --arm steward --atm-backend real \
  --compose-window-ms 0 --seed 11 --scheduler-seed 1011 --agents 3 --trials 5 \
  --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force
```
