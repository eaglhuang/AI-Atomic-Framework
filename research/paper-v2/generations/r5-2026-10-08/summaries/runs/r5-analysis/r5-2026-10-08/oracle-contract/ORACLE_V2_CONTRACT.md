# Oracle v2 契約案例結果（r2 P0-2）

oracle：`c4-fullbytes-frame-v2`；對照 r1：`c3-effect-bytes-v1`。全部通過：**true**。

每例：手寫獨立 expected full bytes（sha256 見 JSON）、未變行 mask、期待 verdict、實際 verdict；並檢查 oracle 自己的 reference applier 是否重現手寫 bytes。這些是不同契約路徑的覆蓋，不是統計獨立樣本。

| case | 審核項目 | 期待 (v2) | 實際 (v2) | r1 presence oracle | frame | structure | ref=手寫 | mask | pass |
|------|----------|-----------|-----------|--------------------|-------|-----------|----------|------|------|
| C0_positive_control | control | {"c-i1":"correct","c-i2":"correct"} | {"c-i1":"correct","c-i2":"correct"} | {"c-i1":"correct","c-i2":"correct"} | true | true | true | true | ✅ |
| C1_marker_ok_neighbour_corrupted | 1 所有 marker 正確，但未授權的鄰近原文被改壞 | {"c-i1":"frame_violation","c-i2":"frame_violation"} | {"c-i1":"frame_violation","c-i2":"frame_violation"} | {"c-i1":"correct","c-i2":"correct"} | false | true | true | true | ✅ |
| C2_effect_misplaced | 2 正確效果被放錯位置 | {"c-i1":"misplaced"} | {"c-i1":"misplaced"} | {"c-i1":"misplaced"} | true | true | true | true | ✅ |
| C3_region_tag_missing | 3 缺 region 標籤 | {"c-i1":"region_missing"} | {"c-i1":"region_missing"} | {"c-i1":"correct"} | false | false | true | true | ✅ |
| C4_effect_duplicated | 4 相同效果重複出現 | {"c-i1":"duplicate"} | {"c-i1":"duplicate"} | {"c-i1":"duplicate"} | true | true | true | true | ✅ |
| C5a_legal_delete | 5 合法刪除／替換，不應因 marker 消失而誤判 | {"c-i1":"superseded","c-i2":"correct"} | {"c-i1":"superseded","c-i2":"correct"} | {"c-i1":"lost","c-i2":"n/a(no-op-kind)"} | true | true | true | true | ✅ |
| C5b_legal_replace_of_original | 5 合法刪除／替換，不應因 marker 消失而誤判 | {"c-i3":"correct"} | {"c-i3":"correct"} | {"c-i3":"n/a(no-op-kind)"} | true | true | true | true | ✅ |
| C6_legal_supersede | 6 合法後續操作取代先前效果，不應算成 lost | {"c-i1":"superseded","c-i2":"correct"} | {"c-i1":"superseded","c-i2":"correct"} | {"c-i1":"lost","c-i2":"n/a(no-op-kind)"} | true | true | true | true | ✅ |
| N5_illegal_disappearance | 5 的負例（無授權刪除） | {"c-i1":"lost"} | {"c-i1":"lost"} | {"c-i1":"lost"} | true | true | true | true | ✅ |
| N6_supersede_by_uncommitted | 6 的負例（取代者未提交） | {"c-i1":"lost","c-i2":"blocked_leak"} | {"c-i1":"lost","c-i2":"blocked_leak"} | {"c-i1":"lost","c-i2":"n/a(no-op-kind)"} | true | true | true | true | ✅ |
