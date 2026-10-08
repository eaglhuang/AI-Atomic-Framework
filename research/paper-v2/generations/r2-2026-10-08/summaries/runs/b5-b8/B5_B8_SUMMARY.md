# B5–B8 總表

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 22:43 CST（Asia/Taipei） |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| 探針 | `runs/b5-b8/probe.mts` → `probe.out` |
| ATM 源碼 | **未修改**（唯讀 pin） |
| 宣稱 | **無勝出／無 RQ 主結果**；僅 B 階正確性收尾 |

## Pass／fail

| ID | 狀態 | 一句話 |
|----|------|--------|
| **B5** | **pass** | 真 S4 stale → blocked；re-propose 成功 |
| **B6** | **pass** | 六格邊界矩陣對齊 #198 凍結契約；無 blocked cell |
| **B7** | **pass** | 重排 hash 不變；permutation count 真實；拒絕前後 hash 同 |
| **B8** | **pass** | `failAfterWrites:1` → `rolled-back`＋全檔還原（例外補償） |

## Stock

| 驗證器 | 結果 |
|--------|------|
| validate-broker-cowrite | ok |
| validate-broker-steward | ok |
| transactional-steward-rollback | ok |

## 產物路徑

- `/workspace/reports/atm-v2-harness/runs/b5-b8/`
- 紀要：`runs/steward-writer/STEWARD_WRITER_B5_B8.md`

## 下一階

**E1** pilot（3 workloads × 主臂 × 少 seeds；**不宣稱勝出**）。B ladder 完成。
