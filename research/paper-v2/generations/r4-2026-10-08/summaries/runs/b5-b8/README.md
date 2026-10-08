# B5–B8 — composer／steward 邊界與回歸（ATM pin `5692474f…`）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 22:43 CST（Asia/Taipei） |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（#198 merge） |
| 本機樹 | `/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| Node | v24.10.0（`/home/box/.local/node24/bin/node`）＋`--experimental-strip-types` |
| 角色 | B 階收尾：S4 stale、邊界契約、排列 property、S5 rollback |
| 約束 | **未**改 ATM 源碼；**未** publish／tag／merge |

## 重跑

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
NODE=/home/box/.local/node24/bin/node
cd /workspace/reports/atm-v2-harness/runs/b5-b8
# stock（可選）
(cd "$ATM_MONOREPO" && "$NODE" --experimental-strip-types scripts/validate-broker-cowrite.ts --mode validate)
(cd "$ATM_MONOREPO" && "$NODE" --experimental-strip-types scripts/validate-broker-steward.ts --mode validate)
(cd "$ATM_MONOREPO" && "$NODE" --experimental-strip-types tests/core/transactional-steward-rollback.test.ts)
# 探針
"$NODE" --experimental-strip-types probe.mts | tee probe.out
```

## 產物

| 檔 | 說明 |
|----|------|
| `probe.mts` | B5–B8 探針 |
| `probe.out` / `probe.jsonl` | JSONL 結果 |
| `EXPECTED.md` | 凍結期望 |
| `B5.md`…`B8.md` | 分項紀要 |
| `B5_B8_SUMMARY.md` | 總表 |
| `stock/` | 既有 ATM validators 輸出 |
| `checksums.sha256` | 校驗 |

下一階預設：**E1** pilot（不宣稱勝出）。
