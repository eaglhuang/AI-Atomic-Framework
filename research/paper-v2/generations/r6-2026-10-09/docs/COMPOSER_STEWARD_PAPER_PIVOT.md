# Composer＋Steward 論文主軸轉向（2026-10-07）

## 決策
- 文一選定 **Composer＋steward 共寫合成** 為 ATM 論文 v2.0 主貢獻（真正平行合併），功能完成後才寫／投稿論文。
- 冷熱排隊／#180 降為支撐或附錄；不取代此主軸。
- 暫定題目方向（待功能後定稿）：共寫合成／deterministic co-write／admission＋steward apply。

## 已知缺口（寫稿包）
- harness「0 lost」綁 **sync writer**（理想 rebase）；未驅動 `composeBrokerProposals`／steward apply。
- stale writer 對照：無 composer 時 lost **55–65%**，與 control 相當 → 證明准入 alone ≠ 不丟更新。
- 熱檔同區第二／三 writer 常 route 到 composer_merge；語意待確認。

## 成功方向（給實作）
1. 多 agent 對同檔不同／可合併 region 提交真實 patches。
2. Broker 路由到 compose；**中立 steward** 套用合成結果（非提案 agent 直接覆寫）。
3. Ground-truth：合成後檔案保留各方非衝突變更；衝突不可合併則 fail-closed／可觀測。
4. 測試／腳本可重跑；開 PR，**不 merge、不 npm publish**（除非使用者明示）。
