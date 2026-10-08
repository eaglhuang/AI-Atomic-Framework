# REPRODUCE（r2，2026-10-08）— DRAFT，不宣稱勝出

> r1 的 `reproduce.sh` verify 會**改寫** manifest 與 checksums（外審 P0-3）。r2 起 `reproduce.sh` 只是分派器，四個動作各司其職、互不混用。

| 指令 | 寫入？ | 做什麼 |
|------|--------|--------|
| `./reproduce.sh verify <generation-dir>` | **否**（嚴格唯讀） | `sha256sum -c --strict SHA256SUMS`；缺檔／改檔 → 非零退出；列出未登記檔（警告） |
| `./reproduce.sh analyze [OUT]` | 只寫 `OUT`（預設 `runs/r2-analysis/<ts>`；已存在且非空則拒絕） | 從凍結 raw：oracle v2 契約案例、oracle v2 重評、E4 鑑識彙整、E1–E5 表重建＋與 r1 比對、cell 出處索引、r1 E3／E4 extractor 沙盒重跑並與 r1 比對；前後對 raw 做指紋，若有變動即失敗 |
| `./reproduce.sh rerun cell <新id> <子命令> [...]`／`rerun e4-forensics`／`rerun matrix <e1..e5> <TAG>` | 只新增新 run id | 永不覆寫既有 cell（新 id 已存在即拒絕）；matrix 會把所有 rid 加上 `rr<TAG>-` 前綴 |
| `./reproduce.sh seal <staged-generation-dir>` | 只寫該新 generation 的 `MANIFEST.json`＋`SHA256SUMS`（最後產生）＋`verify.sh` | 已封存（SHA256SUMS 已存在）即拒絕；拒絕 symlink 與 >25 MB 檔 |

環境：Node `/workspace/.nvm/versions/node/v24.21.0/bin`；`ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀）。

從上傳的 generation 重跑 analyze：在 `harness/` 下依序解開 r1 `raw/*.tgz` 與 r2 `raw/*.tgz`（路徑皆為 `runs/<cell>/…`），再把 r1／r2 的 `summaries/runs/*` 放回 `runs/`，最後 `./reproduce.sh analyze /tmp/out`。

r2 新增的 MP 選項：`run-mp --steward-apply-lock on|off`（預設 off＝重現 r1 行為；on＝r2 候選緩解，標 `arm_role=mitigation_candidate`，不是 r1 主臂）。

## r3（ATM PR #213 驗證，2026-10-08）

```bash
# 先依 runs/r3-validation/PINS.json 準備兩個 ATM pin（commit tarball 解壓；node_modules 同 5 個 symlink）
./runs/r3-validation/run_r3.sh                 # barrier → replay(225) → matrix(45) → regression(180)；拒絕覆蓋既有 r3* run
./runs/r3-validation/run_r3_sp_noise.sh        # 單 process E4 雜訊補測（30）
node test/barrier_interleave.mjs --atm <ATM_MONOREPO> --out <dir> --reps 20 [--lregion selectors --fregion reducers]
./reproduce.sh analyze runs/r3-analysis/<新空目錄>   # 唯讀；含 r3-compare/R3_TABLES.md
```

時間與機器負載會影響 MP 重播與延遲數字；barrier 測試為確定性（不依時序）。


## r4（ATM PR #214 驗證，2026-10-08）

```bash
# 先依 runs/r4-validation/PINS.json 準備三個 ATM pin（5692474f、bea35380、2118bc66；commit tarball 解壓；node_modules 同 5 個 symlink）
./runs/r4-validation/run_r4.sh                 # barrier → replay(450＝6 臂×75) → matrix(63) → regression(180) → faults；拒絕覆蓋既有 r4* run
PHASES=barrier ./runs/r4-validation/run_r4.sh  # 只重跑 barrier（輸出目錄已存在時請先換 --out）
node test/r4_fault_scenarios.mjs --pins "2118bc66=<tree>,bea35380=<tree>" --out <新目錄> --reps 10   # F1–F6；F6 需 `unshare -Urpf --mount-proc`
./reproduce.sh analyze runs/r4-analysis/<新空目錄>   # 唯讀；含 r4-compare/R4_TABLES.md
```

注意：before-precheck barrier 正式結果為 v2（follower 進入檢查點後 leader 才提交）；v1 輸出保留為 `runs/r4-validation/barrier/superseded-v1-*`，不計入。消融臂以環境變數 `ATM_BENCH_RECOMPOSE_POLICY`（JSON）轉為 ATM 公開輸入 `recomposePolicy`；只有 (c) 能這樣關閉。
