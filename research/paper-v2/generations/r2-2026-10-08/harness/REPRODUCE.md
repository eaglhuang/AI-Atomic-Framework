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
