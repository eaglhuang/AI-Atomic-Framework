ATM 論文 2.0 證據包審核與補測建議
審核日期：2026-10-07（Asia/Taipei）
對象：review-pack.tgz／REVIEW_PACK_FOR_EXTERNAL_AI.md
研究版本：candidate 5692474f7db70ab52a7a71c8af4867609e7e4b43

結論

這包有實質幫助，已把前輪「只有研究規劃與作者報告值」推進為可審閱的實驗摘要、基線比較和失敗線索。但尚不足以把主實驗標成獨立驗證完成，也不宜升 final 或宣稱一般性安全／效能優勢。

最值得先做的不是增加試跑數量，而是：處理 E4 正常主臂的 lost=1；補完整、獨立的正確性裁判與原始事件；修復封包校驗及重現流程。這三項決定目前 correct、goodput 與 safety 數字究竟能支持多強的結論。

研究不必以 ATM 勝出為終點。若結果可靠地展示治理成本、適用條件、可稽核的終態與失敗邊界，即使 lock/OCC 比較快，也能形成有價值的系統或經驗論文。是否足以獲特定會議接受，仍取決於新穎性、定位與該會議標準，不能保證。

一　本次實際核對的範圍

1. 保留上傳原件，安全解開壓縮包；review-pack/ 內有 55 個普通檔案，另有包外說明副本。
2. 閱讀說明、版本錨、指標定義、實驗摘要、基線／steward 紀要、F1/F2、manifest、checksums 與 reproduce.sh；全文對照本包 780 行論文草稿。
3. 以獨立的純資料解析重算 E1 45 格、E2 150 格、E3 摘要可見的 30 格、E4 18 格、E5 JSON 18 格；未見超出顯示精度的主要表格算術錯誤。
4. 獨立比對所附 checksum 與檔案 bytes。未執行包內 harness、probe、reproduce.sh 或任何新產品實驗。
5. 因為完整 source／oracle／harness、逐格 raw events 未附，本次能核的是「摘要內部一致性與證據充分性」，不是獨立重跑主實驗。E5 的 compare_raw.json 仍屬 cell 級彙總，不能只憑名稱視為原始事件。

上傳 tgz：142,794 bytes
SHA256：c9a98cc843528e9b3cd406cacc79c7fef71531a1f404da9bde48683e72ca8fab
下列檔案與行號均指該包未修改的 review-pack/ 內容。

二　這次真正補上了什麼

1. 真實 compose→steward 路徑的接線紀錄，比以理想化同步 writer 的零 lost 代替 ATM 更有說服力。但窗口管理由 harness 負責，應寫清 ATM core 與外部編排的邊界。
2. 增加 file-lock、OCC、Git three-way 與 bare composer，比只和故意錯誤的寫法比較更扎實。
3. E2 增加 10 個 workload seeds 與配對資料。逐格數字及大部分彙總可核算，不能再說完全沒有數據。
4. E3 有 window=0 對照；E4 有真正多 process 拓撲的作者報告；E5 把 blocked、例外補償、recovery-required 分開。
5. DRAFT、fault 非競爭者、rollback 非 crash atomicity、MP window 不跨 process 等限制已明列，方向正確。

三　目前最重要的阻擋

P0之一：E4 正常主臂已有一筆 lost

E4_SUMMARY.md 第69行：main_steward_mp、cas、apply-lock on、2 processes、seed17、scheduler1017，correct=20、lost=1、blocked=13。第37行也列三 seeds 的 lost mean=0.33。

這是正常主臂，不是關閉鎖的故障臂。F2 第16行只選 p8 的 lost=0，本身可作選摘，但不能代表整體 MP 零遺失。零殭屍 lease、收據數相等也不能消除這個反例。

先取回這一格的：完整輸入、預期效果、每 attempt／batch、鎖取得與釋放、commit ack、收據、最終檔、oracle 逐筆理由。判斷是哪一層：真實已確認效果遺失、合法後續取代、oracle 映射錯誤，或計數錯誤。沒有原始證據前，不能斷言 ATM core 一定有 bug；也不能把它當噪音忽略。

論文第525行原本已有「資料破壞／oracle 不一致先停效能結論、保存根因」的停止規則，這一格應觸發該規則。先保存、定位、建立回歸，才恢復強效能／安全結論。

P0之二：正確性裁判尚未證明達到完整 bytes 與 frame 契約

C3 紀要第13–22行描述 exact_line/token 出現次數、可選 region；region 不見時仍可用 presence 判定。這比模糊字串搜尋進步，但未必能抓到「marker 都還在，其他原始 bytes 被刪除或改壞」的情形。

論文第466、470行與 METRIC_DEFINITIONS 第78行要求的是獨立 expected output、完整 bytes 與 frame property。所附 oracle.mjs 缺席，不能判斷真實實作是否另有檢查；目前只是沒有足夠證據滿足這個較強契約。

先補 6 類最小正負例：
- 所有 marker 正確，但未授權的鄰近原文被改壞
- 正確效果被放錯位置
- 缺 region 標籤
- 相同效果重複出現
- 合法刪除／替換，不應因 marker 消失而誤判
- 合法後續操作取代先前效果，不應算成 lost

每例需獨立 expected full bytes／digest、未變區域 mask、期待 verdict 與實際結果。不能讓受測 composer 自己生成裁判的正解。這些是不同契約路徑的覆蓋，不是六個統計獨立樣本。

P0之三：封包不是已驗證的可重現交付

頂層 checksums.sha256 有25筆，按原路徑只有7件存在：3 match、4 mismatch、18缺路徑。四件實際 bytes 不符的是 VERSION_ANCHORS.md、ARTIFACT_PACK_SPEC.md、artifact_manifest.json、EXPERIMENT_CHECKLIST.md。

若人工把唯一對應的摘要搬移位置重新映射，可再核對9筆：合計12 match、4 mismatch、9缺件。E2/E3/E4各自的 seeds.json 與 SEEDS_REGISTERED.md 缺席；目前扁平目錄中的同名檔是E5，不可混用。B5–B8 checksum 15項中4 match、11缺件；historical probe checksum 3項全缺。

校驗不符代表「所附指紋未綁定當前內容」，可能是封存後又更新文件；本包無法判定原因，這不等於造假。

reproduce.sh 的 verify-only 有更直接的問題：第45–52行主要檢路徑與檔案存在；第97–172行重寫 manifest；第174–183行只查 probe 存在；第199–234行重寫 checksums，沒有先比對舊指紋，也沒有重建主表。它可能把現況重新登記成基準，不能靠 exit 0 證明原包沒變。--full 只覆蓋E2，不是E1–E5全重建。

應分成三個命令與三項驗收：
- verify：唯讀檢既有全檔 manifest，缺／改檔必須失敗
- analyze：由 frozen raw events 重建所有表圖，不改原資料
- rerun：依 frozen source／config 執行新實驗，另存新的輸出
封包重新產生指紋的 seal／refresh 應是另一個明確動作，不能混在 verify 裡。

四　目前數據實際說了什麼

E2 的三類 workload 每臂 offered 總和為401。表內：
- steward、file-lock、OCC：各 correct401、blocked0、lost0
- Git three-way：correct399、blocked2、lost0
- bare composer：correct323、blocked78、lost0
這只是在當前裁判及摘要口徑下的結果，不是已獨立驗證完整檔案正確。

hot_conflict 的 mean goodput：steward26.11、file-lock76.26、OCC87.90 correct/s。steward沒有比這兩個基線更快，三者觀測完成率又相同。因此應研究「治理增加什麼保證、付出多少成本」，不要把資料改寫成全面勝出。

E3 hot_conflict：window0／100／400ms皆報100%完成；goodput37.97／27.43／11.47，batch mean約1／1.159／1.136。這批工作負載裡，長窗口主要增加等待，沒有觀察到完成率收益。這是有價值的負結果。若要研究真正合成收益，應新增同一base、2／4／8份可相容patch的同步burst，別只增加現有近單件批次的run數。

E4 p8 平均eligible完成率約52.94%，SP约88.89%。process-local window是合理的候選機制，但沒有控制介入證據前，不能把全部差異或lost=1都歸因於它。

E5 F2 的7 blocked／2 rolled-back／6 recovery-required／3 commit是18個cell的分類，不是18筆logical operations的終態分布。三個OCC-exhaust cells其實包含41 offered、26 committed/correct、15 blocked。可以畫成測試情境覆蓋表，不能畫成交易成功失敗比例。

五　你的四項 caveat 怎麼判

1. E1/E2 logical_id等於intent_id
不必為字串相同直接廢棄150格。若一intent確實代表一logical task，而且retry映射穩定，原數據可從events重算救回。真正要驗的是同logical、多attempt、最多一次正確效果與固定offered分母。新ID加log前綴本身不證exactly-once。

C2第50、97行仍說re-propose是stub；手工換hash重新apply不能代替stale→fresh base→重新提案→deadline→重播去重。若原始mapping不完整或oracle/行為改了，才重跑受影響矩陣，不能把新版本hash補到舊run上。

2. MP compose window不跨OS process
是重要架構限制，不能寫成跨程序協同合成已驗證。可把現結果定位為「process-local batching＋共享registry／apply-lock」的觀察。先對帳lost反例，再決定縮窄论文范围或實作跨process機制；單純再跑p8/p16不會補上協定缺口。

3. fault臂不是競爭者
這個區分是正確的，必須保留。它們可用來測試監測與守衛的作用，不可因關掉鎖後更差就推導ATM勝過正常lock/OCC。

4. candidate升final前要稿凍結
正確，但目前不只是文字整理。論文本體仍保留3b0f7660、PR198未合併和主結果待測的舊狀態，與包的5692474f不同。版本、原始工件、oracle、論文每張表必須對到同一代；正文同步不能列為optional。

六　還要補哪些測試與數據

第一階段　先補既有證據，不增加run

A. E4 p2 seed17完整失敗格，優先於任何大矩陣
B. E2全150格、E3全120格、E4全18格、E5全18格的既有工件，可分包但用一份manifest串接。若只能先交部分，至少交主表所有格＋全部失敗格，並明列缺件，不稱全包可重現
C. 每代 immutable harness／oracle／ATM source、run scripts、fixtures、package與lockfile、分析程式；每run三個版本hash與config／seed／scenario hash
D. raw events、expected effects、policy、base／patch／output、oracle結果、stdout／stderr／exit、起訖及clock基準
E. analysis-only重建每張主表；修复四個checksum mismatch、搬移路徑與seed同名覆蓋問題

第二階段　小型高價值契約測試

A. 上述6類oracle正負例，完整bytes＋frame
B. 6條logical生命週期：單次成功、CAS/stale後fresh重提成功、重提耗盡、重複投遞、commit後receipt-loss重送、restart後同logical重送。每例offered固定1、attempt如實、correct最多1；不支援的情形明示recovery-required而非虛構恢復成功
C. 獨立policy矩陣：不相交修改、context-only共享、真正changed-span衝突、same-gap插入，共4族；各2個邊界變體、2種順序，先16例。若契約要測stale-base拒絕，再加對應16例。每例先定should-accept／deny與expected bytes，再算unsafe acceptance／false rejection，分母0報N/A
D. MP最小交錯：先2個process、固定同base兩patch，以barrier控制read／compose／pre-CAS／write／ack順序；另列late joiner、不同base、鎖開關的正負控制。解決反例再延伸2／4／8process
E. write監測正向控制：刻意直接寫一次必須能偵測，交actor/PID/path、監測起訖與涵蓋分母。零事件欄位不等於OS權限隔離
F. 只有要保留恢復主張時，才補kill／rollback failure／receipt loss三類各2個實際cutpoint的restart→reconcile→retry，共6條路徑。核磁碟bytes、唯一效果、收據、lease及恢復時間；否則明列恢復未支援，不強行擴成耐久性專題

第三階段　公平比較與統計

先修基線口徑：D1/D2的lock/OCC也經ATM admission，所以現在主要是共同准入下的提交策略比較。Git/bare一律等timeout，steward有單件立即路徑，成本差不能全歸因合成或治理。

將兩個問題拆開：
- 固定batch／patch trace，量純合成能力及成本
- 固定到達trace、共同契約／retry預算／deadline，量端到端成本
只有要主張broker本身的獨立價值時，才另外加入broker-off正確lock/OCC；不必所有維度全做笛卡兒積。

可執行的起始矩陣是3 workloads × 5 arms × 10 workload seeds × 3 scheduler seeds＝450 runs。若舊資料完全可稽核且同一版本契約，可只新增300；若oracle／harness／ID行為改了，應新一版450，不能混代。這是成本合理的起點，不是450就保證顯著。先按配對差異變異與目標CI寬度規劃樣本數，預先登記擴量規則。

統計至少補：逐seed點、配對效果量、以workload為cluster的95%CI；多scheduler用分層或先在workload內彙整。mean±母體σ不是95%CI。mean-of-ratios與ratio-of-sums必須標清；例如bare hot_conflict平均run率0.6361，而總數87/139＝0.6259，兩者估計目標不同，不是算錯。

每格僅約11–15個logical時，p95/p99容易都等於最大值。若真要主張p99，每預定群約2,000 latency observations才約有20個1%尾部點，仍需跨獨立run估不確定性；不能把2,000相關操作當2,000個獨立安全樣本。

零事件也不是零風險。只有在獨立、同分佈Bernoulli機會假設下，一側95%上界才是1−0.05^(1/N)；零失敗要讓上界低於5%至少59次，低於1%至少299次。這只是量級說明，不是叫你把同一deterministic probe跑299遍。若論文只主張有界機制與反例，無須追求這類低失敗率保證。

最後補2–3個真實repository的patch traces，含程式／設定／文件、replacement／deletion／multihunk，比再加一堆註解marker更能檢查外部效度。這些均為建議，尚未執行。

七　成稿前的最低通過條件

- 全包唯讀校驗通過，版本／seed／run／表來源都能追溯
- E4正常主臂lost反例已保存、定位，論文誠實報告修前／修後或未解限制
- 完整oracle的負例有效，所有correct／goodput能追到逐筆裁判
- logical／attempt／receipt能對帳；同數量不等於同集合
- 基線公平且歸因明確，故障臂與主基線分開
- 原始資料可重建全部主表，正文與候選版本一致
- 所有proof、recovery、write authority、MP與尾延遲主張都不超過證據範圍

我的建議是先完成第一、第二階段，再決定第三階段追加多少run。不要直接套用前輪1170或更大數量的建議；新的證據已顯示，眼前最缺的是可稽核性與契約正確性，而不是總數量。

主要證據索引
REVIEW_PACK_FOR_EXTERNAL_AI.md §5–7：四項限制與摘要包範圍
E2_SUMMARY.md L49–65、91–240、245–249：比較表、150格與聚合／stub
E3_SUMMARY.md L46–60、66、132–161：窗口成本與可見逐格
E4_SUMMARY.md L16、26–29、37–42、62–79：MP邊界、計數、反例
F2_CORRECTNESS_TABLES.md L16、24–33、37–42：選摘、partial與cell分類
STEWARD_WRITER_C2.md L48–50、95–97：監測欄與re-propose stub
STEWARD_WRITER_C3.md L13–22、36–38：oracle文檔契約
D1.md L12、52；D2.md L23、66；D3.md L25–27；D4.md L17–26：准入／批次／MP基線限制
METRIC_DEFINITIONS.md L78、123–126、138–175：完整正確性、收據、監測及最小欄位
reproduce.sh L45–52、97–183、199–234：verify／seal實際邊界
ATM_PAPER_V2_DRAFT_zh.md L8–10、174–187、466–470、525、529–559：版本、oracle及停止規則
