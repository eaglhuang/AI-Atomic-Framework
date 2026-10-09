# ATM 論文 v2.0 — 可行性審閱吸收對照（2026-10-07）

- 審閱來源：`ATM_PAPER_V2_FEASIBILITY_REVIEW.md`（作者附 docx 之提取）；定位為**修稿／實驗設計規範**，未作為對等正文併入。
- 修訂前備份：`ATM_PAPER_V2_DRAFT_zh_pre_review.md`（508 行，sha256 `68bba61e…4086`，與修訂前正文相同）
- 修訂後正文：`ATM_PAPER_V2_DRAFT_zh.md`（狀態仍為草稿／非正式投稿）
- 舊冷熱稿 `ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md` 未動。
- 原則：未改 ATM 程式、未開 PR、未跑新實驗、未填任何新結果數字；舊數字一律標〔作者報告值〕；審閱聲稱的版本狀態標〔審閱核對 2026-10-07〕（作者尚需自行確認）。

## A. 結構

| 審閱建議 | 位置（審閱） | 稿中處理 | 新稿位置 |
|---|---|---|---|
| 題名改為「確定性合成與受治理提交」，避免「真正平行合併」 | §二 | 採用審閱題名中英原文；front matter、H1、定位句、§1.1 名詞釐清（proposal 平行／batch 合成／單一受控 commit） | 標頭、§1.1 |
| 主文順序 1–8（§十四） | §十四 | 全文重排為：1 問題與範圍 → 2 v1 承諾與歷史診斷 → 3 協定與信任模型 → 4 合成性質與實作 → 5 評估方法 → 6 結果與 tradeoff（預留）→ 7 限制及相關工作 → 8 結論 | 全文 |
| 冷熱／queue／registry 舊結果降為背景 | §十四 | 舊 §8 整節移至附錄 A，加版本綁定與 caveat | 附錄 A |
| 貢獻收斂為 C1／C2／C3（表 1） | §二 | 舊 C-main＋C-motivation＋C-support-1..4 改為 C1 協定／C2 保留性契約／C3 成本實證；附「成立所需」欄 | §1.4 |
| 修復 ≠ 研究貢獻 | §二 | 四項缺口（位移、寫死 permutationStable、缺 blocked 收據、proposer≠steward 未比對）寫為「對 v1 承諾的端到端驗證」；P0 表改名「歷史缺口修復清單」並對應 C1/C2/C3 | §1.4、§2.7 |
| RQ1–RQ4（§十四） | §十四 | 原 RQ1–RQ5 由審閱 RQ1–RQ4 取代；加 RQ→指標→比較對應表 | §1.3、§5.1 |
| 摘要示例 | §十四 | 以審閱「沒有虛構結果的摘要示例」為底，補入 stale 動機（作者報告值＋故障注入 caveat）與 v0.1.17 探針、main／#198 分層句；明寫不主張已證明零 lost | 摘要 |
| 若只修 v1 承諾且無實務差異 → 改投修正說明／經驗報告 | §一 | 寫入 §1.4 末與 M5 決策點、§8 | §1.4、§5.7、§8 |

## B. P0 措辭／技術校正

| 審閱 P0 | 稿中處理 | 新稿位置 |
|---|---|---|
| stale／raw overwrite 被推為 ATM 能力界線 | 改稱「故障注入負面對照」；sync 改稱 harness 正確性參考、非真實合併上界；主比較預留 lock、CAS retry、Git three-way、bare composer、完整 ATM（表 6 全採） | 摘要、§2.3、§5.2 表 E1 |
| 「同一組准入決策」 | 改為相同 seed 與設定，實際准入序列未必相同（舉 210 vs 206、84 vs 88），需 decision／batch trace replay | §2.3 第 3 點、§5.7 M3 |
| `serializabilityProof` 命名 | 更名 composition determinism；說明排列不變性是合成函式性質，可序列化需讀寫歷史；排列測試／#198 的 n+1 有界檢查不是證明；不放 n! 於 hot path | §4.5 |
| `@@` old range 不含 context（舊 §5.3 說法） | 依 GNU 更正：old range 含 context＋刪除行；分 changed span／context span／insertion gap；同 gap 雙插入無序須拒；首尾／相鄰／重複／多 hunk 需唯一定位 | §4.2 |
| identity gate 被當安全保證 | 改稱「角色一致性檢查」；proposer 零直接寫入＝「已監測路徑中未觀測到」，附監測覆蓋率；列 #198 邊界（去空白標籤、空 ID、無 kind） | §3.5 表 C2、§4.7、§5.4 write authority |
| temp＋rollback 被當原子交易 | 拆成例外補償／單檔替換／crash recovery／多檔可見性四列；未測前不稱 crash atomicity；process kill ≠ 斷電 | §3.5、§4.8 |
| 版本混用 | 新增版本分層表 V1：v1 tag object `0b31aa86` ≠ source commit `a897f144`（修正舊稿把 0b31 當 commit）；歷史基準 v0.1.17 `8dd6a1c6`；main `3b0f7660`；候選 #198 `65e8aab3`（未合併、四項契約差異表）；「全部尚未修好」改為審閱句 | §2.2、§2.6、附錄 B（加 main／#198 兩欄） |
| #184／park 狀態過時 | FileHeat PR #197、native hot parking PR #199 已合併（標審閱核對）；issue open ≠ PR 未合；FileHeat 預設 static、不可寫成完整 EMA；release／expiry 只給重新驗證資格；舊 polling-wait／overlay 不回填為 native ticket 實測；舊「core 無 park」綁 v0.1.17／Oct 6 | §2.6、附錄 A.1/A.2、§7.3 |
| 測試盲點範圍 | 限定為同檔 text PatchProposal 多 proposal 真 apply；註明 MutationRequest 多作者測試已存在 | §2.5 第 5 點 |
| Claim Plane 引用 | 同引 arXiv:2607.21909 與 follow-up 2608.00947（書目依審閱轉述，標待核對）；刪除「只處理准入、與本文不同層次」的舊定位，改為「亦含 immutable patch integration，交集與差異待核對原文」 | §7.2、參考 [13][14] |
| 指標分母不完整 | 新增指標表 E3（offered／attempted／eligible coverage／commit／correct／lost among committed／eligible missing／unsafe acceptance／false rejection／receipt completeness／goodput／write authority）；reject-all 可揭露；分母為零標「不適用」 | §5.4、表 R1 欄位 |
| marker oracle 不足 | 改為完整 bytes／frame property／唯一性／收據對帳；獨立參考實作當裁判 | §5.3、§5.4 |
| R1 64.9% vs 48.79% | **保留 64.9%**；查原表 `HOT_FILE_LATENCY.md` TL;DR 欄位為「lost/rep（佔 commit）」、nativestale commits 266/rep → 172.7/266≈64.9%，說明審閱 48.79% 用的是 354 offered 分母；aggregation 仍待 run 級重算 | §2.3 第 4 點、表 R1 註 |
| seed 42 ×3 當廣泛證據 | 區分 workload seed vs scheduler seed；三次同 seed＝scheduler 變異；推論單位為獨立 workload；配對 traces；零事件上界（299／2,995／29,956）；p99 樣本量、不平均 p95 | §5.5、§7.1 外部效度 |
| 狀態機／batch closure／提交界線（§五） | 新增狀態表 C1、batch closure／late joiner／重提規則、互斥區間內 digest 重驗＋替換＝提交界線（TOCTOU）、最低事件欄位 | §3.2–§3.4、§3.7 |
| 收據終態（§七） | blocked／rolled-back／recovery-required／committed 四態；rollback 失敗不得回 blocked；收據遺失以 op ID＋digest 對帳 | §3.6、S5b |
| 最小定理與三引理（§六） | 單檔同基底命題（決定性／保留性／frame）＋L1–L3 證明義務，標「證明待 M1」；列不涵蓋項 | §4.4 |
| 威脅模型（§七） | 單機、合作式、可信 steward 與 FS；不宣稱 sandbox／OS 隔離 | §1.2 |
| 「約 5 ms」與「156 pairs」 | 註 5.21 ≠ 2.92＋2.2、含 apply_ms；156 pairs ≠ intents／blocked | §2.3 第 5 點、附錄 A.3 |

## C. 評估設計（P1，已寫入計畫但未執行）

| 審閱建議 | 稿中處理 |
|---|---|
| 表 7 工作負載維度、可知正解子集、真 repo traces | §5.3 表 E2 |
| 公平性控制（git merge-file fold 順序、OCC 不可分割提交、相同 trace／預算） | §5.2 |
| 消融表 11 | §5.6 |
| M0–M5 分階段與停止條件 | §5.7（註明與 IMPL_PLAN 原 M0–M3 的對應；主結果標〔待 M2/M4〕） |
| 最小主矩陣 1,170 runs、480 scenario jobs、480 fault runs | §5.7，明標「建議規模，未執行」 |
| 主文圖 1–4、表 R1–R3 | §6 骨架；圖標〔待繪〕／〔待 M4〕 |
| 實驗封包表 12 | 附錄 C |
| 參考 [8]–[12]、[15]–[18] | 參考文獻 [8]–[18] |

## D. 保留（依主代理指示）

- historical probe 五情境表 P1，明確綁 v0.1.17 `8dd6a1c6`（§2.4）。
- stale 55–65% 作動機，加作者報告值＋故障注入 caveat（§2.3 表 M1）。
- S1a／S1b／S2／S3／S4／S5 驗收並擴充 S1c–S1e、S5b（§4.9）；#196 連結（front matter、§2.7）。
- 主 claim 一律〔待 M2/M4〕。
- v0.1.17 程式碼層路徑表（§4.1）、P1-x／P2-x 待辦。

## E. 未採納或刻意未做（待作者決定）

1. **相容性契約**：保守（context 不可交疊）vs #198 精確（可共享未修改 context）——稿中兩案並陳（§4.3），未定案。
2. **是否採 #198 契約整體**（needs-steward 放行範圍、n+1 有界排列檢查、identity 是否補空 ID 拒絕與 neutral kind）——§2.6 對照表列出，未定案。
3. **是否立刻實作 Git three-way（及 lock、CAS retry、bare composer）基線臂**——表 E1 標〔待 M2〕，未實作。
4. **最終 frozen commit／是否打 tag、publish**——未定。
5. **欄位實際命名**（如 `compositionDeterminism`）——建議名，待作者定。
6. **審閱的版本核對（main `3b0f7660`、PR #197／#198／#199 狀態、v1 peeled commit `a897f144`、Claim Plane 書目）**——本稿僅轉述並標〔審閱核對 2026-10-07〕／〔待核對原文〕，本代理未自行上 GitHub／arXiv 驗證。
7. **審閱全文**未貼入論文；§十六 來源只抽取為參考文獻條目。
8. **R1／T6 run 級重算**、5 ms 分段核對——未做（不跑新計算），標〔待 M0〕。
9. 審閱提出的「完整主矩陣 16,200 runs」未寫入正文（只採最小主矩陣）。
10. P1-4（同區路由是設計或 bug）、P1-7（CLI handshake）仍待作者確認。
