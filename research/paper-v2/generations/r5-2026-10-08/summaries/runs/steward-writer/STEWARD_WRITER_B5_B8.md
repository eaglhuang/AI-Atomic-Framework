# STEWARD_WRITER — B5–B8（B 階收尾）

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 22:43 CST（Asia/Taipei） |
| ATM_MONOREPO | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| 產物 | `runs/b5-b8/`（probe／EXPECTED／B5–B8.md／SUMMARY／stock／checksums） |
| ATM 源碼 | 唯讀；未 commit／push／tag／publish |

## 結果表

| ID | 狀態 | 關鍵證據 |
|----|------|----------|
| B5 | pass | 真 S4：`canonical target base hash is stale`；re-propose `applied` |
| B6 | pass | 六格對齊 #198；同 gap 拒；context-only allow |
| B7 | pass | 重排 hash 不變；count=6／2 真實；blocked 前後 hash 同 |
| B8 | pass | `failAfterWrites:1` → `rolled-back`；標例外補償 |

## Stock

`validate-broker-cowrite`／`validate-broker-steward`／`transactional-steward-rollback` 皆 ok（Node 24.10 + `--experimental-strip-types`）。

## 下一階

**E1** pilot。不宣稱勝出。
