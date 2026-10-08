# 重現步驟（一頁）— A5／F3

| 欄位 | 內容 |
|------|------|
| 根目錄 | `/workspace/reports/atm-v2-harness/` |
| ATM pin（唯讀） | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| ATM 路徑 | `/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| 狀態 | **DRAFT evidence — 不宣稱勝出**；CI 綠 ≠ 主實驗完成 |

> 本頁對應 `ARTIFACT_PACK_SPEC.md` §5。預設 **不要**重跑 E2 150 cells；用 `reproduce.sh` 做核驗／輕量重建。

---

## 1. 環境

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
node -v   # 期望 v24.21.0（或相容 Node 24）
test -f "$ATM_MONOREPO/packages/core/src/broker/decision.ts"
```

- Harness **無** git；版本指紋見 `artifact_manifest.json` 的 `harness_commit_or_tree_id`。
- **禁止**對 ATM pin 樹寫入、npm publish、打 tag、merge。

---

## 2. Seed 登記規則（E2）

- 跑前登記：`runs/e2-matrix/SEEDS_REGISTERED.md`＋`seeds.json`
- Workload seeds：`11 17 23 29 31 37 41 43 47 53`
- **Scheduler seed = workload seed + 1000**（例：wl=11 → sched=1011）
- 規則：workload seed ≠ scheduler seed（配對 traces）
- E1 pilot 曾用同一 seed 作 timing（相容）；E2 必須分離

---

## 3. 輕量核驗（預設）

```bash
cd /workspace/reports/atm-v2-harness
bash reproduce.sh                  # verify-only：檢查 pin、關鍵檔、刷新 checksums／manifest
bash reproduce.sh --skip-probe     # 同上但略過 composer-probe smoke
```

成功條件：exit 0；更新 `artifact_manifest.json`（若需）與頂層 `checksums.sha256`。

---

## 4. Composer 探針（historic 紅燈基準）

```bash
# 預設 reproduce.sh 可選跑；或手動：
cd runs/composer-probe
# 見 README.md／EXPECTED.md；probe.mts 綁 v0.1.17 historic，非 #198 綠燈
```

輸出：`probe.out`／`EXPECTED.md`／`checksums.sha256`。

---

## 5. 重跑矩陣（僅在明示需要時）

**預設不要做。** `reproduce.sh --matrix` 預設 `none`。

```bash
bash reproduce.sh --matrix e1    # 呼叫 runs/e1-pilot/run_matrix.sh（會覆寫 e1-* cells）
bash reproduce.sh --matrix e2    # 呼叫 runs/e2-matrix/run_matrix.sh（150 cells；很久）
# E3 window sweep（手動；未掛 --matrix e3）:
#   bash runs/e3-sweep/run_sweep.sh
bash reproduce.sh --full         # 等同 --matrix e2（仍保留既有摘要敘事為 DRAFT）
```

E1／E2 既有 cells **勿刪**；新跑會因 `logical_id` 解耦改變 `scenario_hash`（見 `STEWARD_WRITER_GAPS.md`）。歷史 DRAFT 表仍有效為 stub 時代證據。

手動單格（RQ2 主臂）：

```bash
node src/cli.mjs start --run-id <id> --arm steward --atm-backend real \
  --compose-window-ms 100 --seed <wl> --scheduler-seed $((wl+1000)) \
  --agents 3 --trials 5 --hot-ratio 1 --overlap high \
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force
```

---

## 6. Oracle 核驗

- 實作：`src/oracle.mjs`（fingerprint 在 `artifact_manifest.json` → `oracle_sha`）
- 每 run：`*/scenarios/expected_effects.json`＋`*/artifacts/oracle_summary.json`
- 正確完成率看 `oracle_correct`／`lost`；**禁止**只用 marker 子字串當唯一裁判
- 新 runs：`logical_id` 形如 `log:s11-t000:i0`，**≠** `intent_id`（`s11-t000-i0`）

---

## 7. 期望產出

| 產物 | 路徑 |
|------|------|
| Manifest | `artifact_manifest.json` |
| Checksums | `checksums.sha256` |
| E1 摘要 | `runs/e1-pilot/E1_SUMMARY.md`（pilot only） |
| E2 摘要 | `runs/e2-matrix/E2_SUMMARY.md`（**DRAFT**） |
| E3 摘要 | `runs/e3-sweep/E3_SUMMARY.md`（**DRAFT**；window 含 0） |
| Seeds | `runs/e2-matrix/seeds.json`；`runs/e3-sweep/seeds.json` |
| D5 凍結 | `runs/baselines/D5_SUMMARY.md`（RQ2 main = steward） |

---

## 8. 強制聲明

1. **CI ≠ 主實驗**（見 `VERSION_ANCHORS.md` §3）。
2. **DRAFT — 不宣稱勝出**；E1／E2 表不作最終 RQ2 勝出宣稱。
3. Final ATM pin **TBD**（待 E3+／稿凍結）。
4. ATM pin 路徑 **READ-ONLY**。
