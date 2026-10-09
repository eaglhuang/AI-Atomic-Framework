# E3 workloads

| id | hot_ratio | overlap | 用途 |
|----|-----------|---------|------|
| cold | 0 | low | 低衝突；window 主要影響 batch 等待成本 |
| hot_disjoint | 1 | low | 熱檔不相交；合成機會中等 |
| hot_conflict | 1 | high | 同檔高重疊；window 對 coverage／blocked 最敏感 |

與 E1／E2 相同三元，便於對照固定 window=100 的 DRAFT 表（非 paired 延遲比較：E3 含新 logical_id）。
