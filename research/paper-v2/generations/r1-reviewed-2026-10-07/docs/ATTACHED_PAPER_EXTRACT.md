ATM 論文第二篇研究可行性與實驗設計審閱

針對 2026 年 10 月 7 日繁體中文草稿　｜　供作者修稿與安排驗證使用

一 審閱結論與使用邊界

結論是有條件可行。這個方向能成為一篇系統實作與實證論文，但現稿尚未具備結果論文所需的完整證據。最有價值的主軸是把准入、同一基底上的 patch 合成、受治理提交與可稽核結果串成可檢驗的協定，並量化安全保留更新的代價。

建議先完成規格與證據校正，再決定是否擴大實驗。若最後只修復 v1 已承諾的機制，且優於既有 Git 三方合併或鎖定方案的效果不明顯，應優先考慮修正說明、重現研究或實務經驗論文。若能提出清楚的協定性質與足夠的比較證據，則可保留獨立續篇定位。

現在可保留的內容

• 以 historical probe 說明既有版本的順序依賴與觀測性缺口；必須綁定實際版本與可重現輸入

• 以 stale overwrite 作故障注入動機；明確標示它省略了應有的合成與提交協定

• 以同基底合成、批次提交、拒絕與重提的成本，形成可被證偽的研究問題

現在不能寫成結論的內容

• 全域無遺失更新、100% 安全或零越權寫入；本次未取得能重算這些結果的原始事件與終態工件

• 排列穩定等同可序列化、抽樣排列構成證明、角色字串構成 OS 隔離、多檔 rollback 等同 crash atomicity

本審閱讀取 2026 年 10 月 7 日的 ATM_PAPER_V2_DRAFT_zh.md 全文，共 508 行；另核對公開版本與一手文獻。草稿引述的 harness、probe 輸出、KEY_TABLES 與原始 runs 並未隨此次稿件附上。這表示本次無法驗算，不表示作者沒有這些資料。所有舊數字均視為作者報告值。

本文件提供研究設計與修稿建議，沒有修改 ATM 產品程式、沒有跑新實驗，也沒有將草稿或報告對外發表。

二 貢獻應收斂成三項

建議將主貢獻限縮為下列三項，並讓每一項各有一組規格、實作和證據。immutable base、CAS、互斥鎖與三方合併已有長期研究與實務基礎；新穎性必須來自問題定義、協定整合或可信的實證發現。

表 1 建議的貢獻與成立條件

候選貢獻

研究價值

必須補足

C1 受治理的合成提交協定

明定 proposal、batch、base、steward 與 commit 的責任和結果

形式化狀態機、信任邊界、與 v1 的精確差異、拒絕與重提語意

C2 可檢驗的保留性契約

對受限 patch 集合提供決定性輸出、保留變更與拒絕前無副作用

完整假設、定理或反例、獨立 oracle、邊界測試；不宣稱任意程式語意正確

C3 安全與進度成本的實證

量化可安全整合的工作量與等待、重試、拒絕和跨 process 成本

同一版本、公平強基線、獨立 workload seeds、CI 與 artifact

修復與研究貢獻應分開

行數位移導致套用失敗、寫死 permutationStable、缺 blocked 收據，以及漏做 proposer 與 steward 比對，都是重要的實作修復，但單獨列成四項新演算法貢獻會被挑戰。v1 若已承諾同檔 compose 與中立 steward，v2 應直說哪些承諾先前缺乏端到端驗證，再說明本篇新增了什麼可泛化的知識。

「准入不等於提交安全」是有用的系統診斷原則，但不是本篇才發現的一般性定律。stale 臂故意省略合成協定，因此只能說明缺少該層的後果，不能代表完整 ATM 與其他正確並行控制方法的公平比較。

建議更精確的題名

ATM 同檔多代理提案的確定性合成與受治理提交

Deterministic Composition and Governed Commit of Same-File Multi-Agent Proposals in ATM

「真正平行合併」容易讓人誤以為 canonical 檔同時接受多個 writer。依目前設計，proposal 準備可以平行，合成以批次進行，而 canonical commit 由單一受控寫入路徑完成。題名與圖 1 應說清楚這個區別。

相關工作須同時納入 Claim Plane 原論文與 2608.00947 的 confirmatory follow-up。它亦含 immutable patch integration，不能簡化為只做准入。OT／CRDT 處理不同操作／複本模型，宜比較保證和失敗政策，不必硬做跨模型效能排名。[13–16]

三 正文必改矩陣

以下依現稿章節定位。優先順序 P0 表示不改就會影響主要結論或讀者理解；P1 表示投稿前須完成。

表 2 修稿位置與所需證據

優先

位置

問題

建議修正

P0

摘要 §§1–2

將 raw overwrite 失敗推為 ATM 能力界線

定義為故障注入負面對照；主比較加入正確且可用的基線

P0

§§3 6 附錄 B

v1 承諾、歷史缺口與最新狀態混用

凍結三個版本錨點，歷史探針與候選修補分表

P0

§5.2

排列穩定被命名為 serializabilityProof

改稱 composition determinism；可序列化需額外歷史與讀寫依賴定義

P0

§5.3

聲稱 @@ old range 未包含 context

依 unified diff 格式修正；分開 changed span、context span、insertion gap

P0

§§5.5 7.3

identity gate 與零直接寫入被視為安全保證

說明可冒用字串、I/O 監測範圍與 OS 權限前提

P0

§5.6

temp 與 rollback 被視為原子交易

拆成例外補償、單檔替換、crash recovery 與多檔可見性

P0

§7.3 表 R1

marker oracle 與 lost 分母不完整

增列 eligible、committed、correct、blocked、unresolved；附原始分子分母

P0

§7.5

固定 seed 42 的三次重跑當成廣泛證據

分離 workload seed 與 scheduler seed；以獨立 workload 為推論單位

P1

§§3.3 8 9

相關工作及已合併功能狀態過時

加入 Claim Plane 後續論文；更新 #181/#184，保留歷史版本語境

P1

摘要 §10

目標、作者報告值與核驗結果並列

使用一致證據標籤；撤下尚未核算的精確百分比結論

關鍵算術：R1 的 172.7 若以每 rep 354 intents 作分母，約為 48.79%，不是 64.9%。64.9% 可能採 committed intents 或逐次比例平均；本次資料不足以判定。請保留原始 run 級計數並重新產表，不應直接將 64.9% 改為 48.79%。 Unified diff 的格式更正依 GNU 官方定義。[17]

四 版本與證據應分層

版本快照已核對至 2026 年 10 月 7 日 11:49 UTC；PR #199 合併後的五項 CI 於 11:53:20 UTC 全部通過。歷史 source、現行 main、候選 PR 和量測 artifact 是不同對象；CI 綠燈、PR 合併與小型 fixture 都不等於論文主實驗完成。

表 3 版本定位與可支持範圍

對象

已核對定位

如何用在論文

v1 framework

v0.9.0-alpha.1；tag object 0b31aa86；peeled commit a897f144

0b31 是 tag 物件，不是 source commit；不能把後來缺陷直接倒推至此版 [1,2]

歷史問題基準

v0.1.17；commit 8dd6a1c6

文字 composer 是 sequential reduce，permutationStable 固定 true；probe 數據仍待 artifact [3]

本次 main

commit 3b0f7660

已有 FileHeat 與 native hot parking；text steward 與歷史版本仍為同 blob，尚未含 #198 [4]

修正候選

PR #198 未合併；head 65e8aab3

有 immutable-base 合成與新檢查，但四項契約與草稿不同；不是 final frozen artifact [5a,5b]

既有與最終實驗

舊數字跨 Oct 6 與 v0.1.17；final SHA 尚未定

舊數字以作者報告值標示；所有主比較須在同一最終版本重跑

#184 所涉 FileHeat 已由 PR #197 合併，預設 static，hybrid／learned 是 opt-in，不能寫成完整 EMA 多訊號模型。#181 的 native hot parking 已由 PR #199 合併；release／expiry 只是給重新驗證資格，不會直接授權舊 patch。兩個 issue 仍 open，不代表相關 PR 未合併。舊 polling-wait benchmark 也不能回填為 native ticket／resume 的實測。[6,7]

候選程式與稿件有四項契約差異

• context　原稿任一 context 重疊即拒；#198 允許只共享未修改 context，需先選定契約 [5a]

• needs-steward　候選允許可確定性合成的 text／JSON-pointer 情形；此路由標籤不等於真衝突分母 [5a]

• permutation　候選 n≤4 全排列；n>4 為 rotations 加 reversal，共 n+1 次，有界檢查不是一般證明 [5a]

• identity　候選僅比對去空白的 actor／steward 標籤；空 steward ID 無該項錯誤，direct API 無 neutral kind 參數 [5b]

因此應把「全部尚未修好」改成「歷史基準有已知缺口，main 尚未含修正，候選契約待核定，M2／M3 主結果仍待測」。既有多作者 MutationRequest 測試已存在；測試盲點應限定為本文的同檔 text PatchProposal 真 apply 路徑。

五 先定義協定再主張性質

最小形式化範圍

先證明單一檔案、合作式 writer、唯一且不可變基底 B 的情形。每份 proposal 固定帶有 base digest、actor、proposal ID 與對 B 解析的編輯集合。解析器必須驗證 context、old/new counts、合法路徑與支援的檔案格式；不支援的語法須明確拒絕。

以半開區間表示被消耗的原始內容，另以 gap 表示純插入點。純插入的 old length 可為零；相同 gap 的兩個插入若沒有明定順序，必須拒絕，不能以空集合交集為零就判為不衝突。相鄰端點、檔首、檔尾、重複內容與多 hunk 也要有唯一定位規則。

表 4 狀態與必要記錄

狀態

含義

可計為 committed

proposed

提案產生，保留 logical operation ID、base digest 與 patch digest

否

eligible 或 blocked

經 scope、base、identity、syntax 與衝突檢查

否

batched 與 composed

以 batch ID 封存成員與 base，產生唯一候選輸出

否

validated

完成所要求的驗證；記錄 validator 版本與結果

否

committed

在受互斥保護的 compare-and-replace 完成且獲得提交收據

是

aborted 或 retryable

記錄原因，保持原檔或進入明定恢復流程

否

reproposed 或 exhausted

同一 logical operation 在新 base 重提，或超出預算

否

接受准入不等於提交成功。每個 logical operation 最多計一次有效完成，重試另計 attempts；取消、超時和未處理項不能從分母消失。batch closure 必須明定時間窗或數量閾值、late joiner 的去向，以及誰負責排程。

提交界線

最低事件欄位為 run_id、logical_id、attempt_id、batch_id、base／patch／output digest、actor／pid、reason code、單調時間戳、ATM／harness／oracle SHA。跨 process 計時須明定可比較的 timebase。

只有在同一互斥區間內重新驗證 canonical digest，並完成替換，才有機會把單檔提交視為一個可線性化操作。若比對和寫入之間可被其他 writer 插入，就仍有 TOCTOU 風險；proposal 端的 hash 本身不會消除此風險。

六 建議的最小定理與證明義務

建議先提供下述受限命題，而不是直接宣稱整個系統可序列化。命題必須與支援的 patch 子集合、解析器與 commit 前提一致。

單檔同基底合成命題

設所有有效編輯皆唯一對齊於同一 B；其消耗區間、必要保護的 context 與插入 gap 依明定規則兩兩相容。若 composer 先在 B 上解析所有編輯，依唯一的基底位置規則輸出未改動片段與替換片段，則結果只由 B 與編輯集合決定，不依賴 proposal 輸入順序；每個接受編輯的效果正確實現一次，包含刪除效果，且未被編輯的片段保持不變。

證明應拆成三個引理

• 唯一解析：每個 hunk 對應的 base 區間或 gap 唯一，且 context 與長度檢查已通過

• 無歧義分割：相容編輯把 B 切成不交疊、可排序的保留片段與替換位置；所有插入的邊界規則一致

• 輸出不變性：輸出串接只取決於唯一排序後的集合，故重排輸入不改變 bytes；由片段構造得到保留性與 frame property

若只保證 changed span 不交疊，卻允許 context 被其他編輯改掉，必須另外說明解析在 B 上已完成而非在變動中間檔重新驗證。若選擇 context 也不交疊的保守規則，可簡化假設，但須量化其誤拒成本。

排列測試與可序列化的界線

小集合全排列可作回歸測試；大集合隨機排列可找反例。兩者都不能取代一般證明。n! 枚舉也不必放進 production hot path：可用確定的正規化構造與相容性檢查，再在測試時驗證排列不變性。

排列不變性是對合成函式的性質。資料庫意義的可序列化關注所有已提交交易的讀寫觀測是否等價於某一序列；讀取集合、跨檔依賴與衝突圖若未定義，就不應用 serializabilityProof 命名。單檔合成命題也不證明語意無衝突、liveness、身份可信或 crash durability。

推薦測試同時使用 metamorphic properties：重排 proposal 不變、每個 proposal 只計一次、無關片段 byte 等值、拒絕前後 hash 一致，以及在明定政策下重複提交的 idempotency。

七 信任模型與交易保證要拆開

表 5 主張及其必要前提

主張

必要前提或證據

可接受措辭

proposer 無法自我 apply

可信的 actor 身份綁定；所有寫入入口均檢查；不存在可繞行路徑

目前若僅為字串比對，稱角色一致性檢查

proposer 無法直接寫 canonical

須以 OS 權限或 capability 阻止所有未授權寫入；syscall／filesystem 監測僅能提供觀測證據

wrapper 零事件只能稱已觀測路徑中未見直接寫入，不能稱無法寫入

stale base 不會提交

鎖保護 digest 重驗到 replacement；所有合作 writer 都遵守

在合作式 writer 與鎖協定下防止 stale commit

例外不留下部分更新

列舉失敗點、驗證 rollback 完成、收據與檔案狀態一致

例外處理的補償保證

單檔 crash atomicity

原子替換原語與平台語意；斷電／kill 測試、journal 恢復規則

已測的故障模型內保持舊或新版本

多檔原子性與耐久性

跨檔提交機制、讀者可見性、fsync 與 recovery protocol

未做以前列為限制，不以 rollback 推論

建議明定的威脅模型

最低可行論文可先限定為單機、合作式程序、可信 steward 與可信檔案系統；不處理惡意 root、直接繞過 broker 的程序、惡意身份偽造或分散式網路分割。這個範圍仍有研究價值，但不能宣稱多代理 sandbox 或安全隔離。

若要主張較強的權限治理，就另加 OS 帳號／容器權限、actor 與 process 的身份綁定、canonical 路徑的寫入限制，以及 symlink、hardlink、路徑跳脫、TOCTOU 等測試。不要只增加 neutral 角色標籤就擴張安全主張。

故障收據應描述真實終態

blocked 應表示提交前拒絕且 canonical 未變；rolled-back 表示曾進入寫入而補償成功；recovery-required 表示終態待修復。若 rollback 自身失敗，不能仍回 blocked。收據遺失但寫入成功亦須靠 operation ID 與 digest 對帳，避免重試造成重複更新。 恢復測試設計可參考 SQLite 的 atomic commit 說明，但不能把 SQLite 的保證移植成 ATM 已證實能力。[18] process kill 也不等於斷電；未驗證 fsync 與檔案系統故障模型時，不應主張斷電耐久性。

八 實驗比較必須加入強基線

control、stale 與 sync 保留為診斷臂。主效果應相對至少兩種正確且可運作的基線量測，否則只能證明安全方法優於故意不安全的整檔覆寫。

表 6 各臂回答的問題

實驗臂

實作與角色

用途

raw overwrite

無協調；舊 base 整檔覆寫

故障注入下界，不作正確性競爭者

ATM admission only

相同准入演算法與設定，省略 composer／steward

隔離缺少提交協定的後果

ideal sync

當下同步 read modify write；明確列出理想化假設

harness 正確性參考，不冒稱真實合併上界

per file lock

鎖內讀最新 base、產生或重建變更、驗證並寫回

保守且正確的序列化基線

optimistic CAS retry

由 snapshot 產生變更；CAS 失敗便重新產生或 rebase

一般 OCC 基線，重試與成本全計入

Git three way

相同 base 與相同 patches 經三方合併；採同樣驗證與鎖定提交

既有合併能力與衝突偵測比較

ATM composer steward

真實 proposal API、batch closure、steward apply 與 retry

完整方法，所有結果綁同一 frozen commit

bare composer

相同 immutable composer 與 guarded apply，移除 broker 准入

隔離合成收益與 ATM 路由治理的成本或增益

公平性控制

Git merge-file 是雙側三方合併，n-way 必須披露 fold 順序且測順序敏感性；不以 ours／theirs／union 掩蓋衝突。OCC 的 validation 與 write 必須共用不可分割的受保護提交區間。[8,9]

• 相同 logical tasks、base fixtures、到達時間、patch 內容與依賴；優先用預先產生的 patch trace，避免模型隨機性掩蓋合成差異

• 所有正確基線使用相同 correctness oracle、timeout、retry budget、驗證要求與 durability 設定；不得僅給 ATM 額外快取或較寬鬆衝突政策

• 若 Git 能合併 context 重疊案例而 ATM 拒絕，分開列政策差異與執行失敗，並報 eligible coverage；不把不同接受集合直接壓成單一成功率

• 以固定到達負載與固定工作量各測一次；並行度、CPU／I/O 配額與 lock granularity 一致，記錄 warmup、執行順序與環境

同 seed 與同輸入 trace 不保證實際准入序列相同：writer 速度、lease 釋放與 retry 會回饋到後續決策。若要聲稱「同一准入決策」，須另做固定 decision／batch trace replay。

九 工作負載與邊界案例矩陣

先區分文字相容、context 假衝突、真實寫入衝突及語意依賴。高 hot ratio 與高 overlap 無法單獨代表所有風險；最小測試集必須能定位為何接受或拒絕。

表 7 預先登記的測試維度

維度

最低必測

擴大實驗

patch 形狀

等長替換、插入、刪除、多 hunk

rename、binary、mode、CRLF、無尾端換行；不支援者驗證拒絕

相對位置

上方插刪加下方修改；首尾與相鄰邊界

重複 context、空檔、純插入同 gap、零長區間

衝突關係

不重疊；context 重疊但變更不交疊；真 overlap

跨 symbol 語意相依、跨檔 invariant、共同讀依賴

時間與基底

同 base；compose 後變更；late joiner

混合 base、慢 writer、舊 proposal 重播、重複 delivery

併發與熱度

1、2、4、8 workers；cold 與全 hot

16、32 workers；hot ratio 0、0.5、0.8、1.0；偏斜分佈

compose window

0、短、中三檔；另記實際 batch size

timer／count closure、負載自適應；與延遲 SLO 比較

執行環境

單 process async 與 2、4、8 processes

多核心、多機僅在擴大協定範圍時加入

故障注入

context mismatch、stale CAS、validator reject

lock timeout、kill、寫入失敗、rollback 失敗、收據遺失

要有可知道正解的子集

人工合成 workload 的每個 logical edit 都帶不可重複的語意標識與基底座標，oracle 由獨立參考實作產生完整 expected output。對 context 重疊案例，可由獨立參考實作或人工規格判定應允許／應拒絕，避免讓受測 composer 同時充當裁判。

再加入至少數個真實 repository 與不同檔案類型的 patch traces，涵蓋文件、設定和程式。使用者真實任務或 LLM 生出的 patch 屬外部效度補強；測試通過只對已測語意規格提供支持，不會證明任意程式的全域語意正確。

十 分母與 Oracle 先於結果表

表 8 建議固定的指標定義

指標

分子與分母或量測點

offered 與 attempted

offered 是唯一 logical operations；attempted 含所有 retry attempts，兩者分開

eligible coverage

依預先登記的獨立政策可處理之 operations／offered；不得用受測方法自己的接受結果循環定義

commit rate

唯一 committed operations／offered；另報 committed／eligible

correct completion

通過保留、精確輸出與必要語意檢查的唯一 operations／offered

lost among committed

被確實 acknowledged commit、且未被後續合法操作取代的應存效果中，終態遺失數／應存效果數

eligible missing

到 deadline 仍未正確完成的 eligible operations／eligible；含 blocked、超時與重試耗盡

unsafe acceptance

應拒絕卻提交的案例／獨立 oracle 判定應拒絕的案例

false rejection

本可按指定政策安全合成卻被拒的案例／該政策允許案例

receipt completeness

具有完整可對帳收據的終端 attempts／全部終端 attempts；系統 crash 也要列入

goodput 與 tail latency

正確完成 logical operations／wall seconds；端到端含排隊、window、retry、驗證與 commit

write authority

已監測 I/O 的 proposer 直接寫入次數；附監測途徑與覆蓋率，不以零事件取代權限證明

marker 不足以當唯一裁判

marker 存在仍可能伴隨重複插入、鄰近內容破壞、錯位或語意錯誤；marker 不在也可能是後續合法刪除。最低 oracle 應比較完整 bytes 或 AST／規格要求，再核對每個操作效果、frame property、唯一性與提交收據。

拒絕全部提案也可得到 zero lost。因此主表必須同時報 offered、eligible、committed、correct、blocked、retry exhausted 與 unresolved，以及 goodput 和延遲。對分母為零的格子標示不適用，不可填 0% 當成安全成果。

R1 與舊 T6 的所有率應從 run 級原始整數重算，標明 ratio of sums 或 mean of per-run ratios。不同版本、不同分母與不同 aggregation 不能接成一個效能提升百分比。

舊「約 5 ms 准入成本」也要核對：§8.3 分項含 apply_ms；5.21 ms 與列出的 2.92＋2.2 ms 不完全相等，可能有未列 stage。另 156 overlapping pairs 不等於 156 intents 或 rejected cases；不要直接推 blocked 率。

十一 統計分析與零事件的解讀

將工作負載變異與排程變異分開

seed 42 重跑三次可以看同一 workload 的交錯變化，不能等同三個獨立 workload。每個情境應先產生多個獨立 workload seeds，再在各 seed 下重跑數個 scheduler seeds；各實驗臂使用配對的 traces。不要把同一 run 的數百個相關 intents 當成獨立樣本來縮窄 CI。

先以少量 seed 做 pilot，估計變異、確認 oracle 與時間測量。之後固定主要結果、最小實務效果、停止規則與種子集合。主分析以 workload 或 repository cluster 為重抽樣單位，報 paired difference／ratio 的 95% CI；必要時採階層 bootstrap，另外展示各 run。

零事件不是失敗率等於零的證明

若 N 個相互獨立且同分佈的機會中觀察到零次失敗，一側 95% 二項上界為 1 減去 0.05 的 1/N 次方；N 足夠大時約為 3/N。這只適用於相應抽樣與獨立性假設，不能直接把同一 process 中高度相關的 intents 數當 N。

表 9 零事件樣本量的量級示例

欲支持的上界

獨立零失敗樣本約需

解讀

小於 1%

299

一側 95% 精確二項界

小於 0.1%

2,995

不是 3 次重跑即可支持

小於 0.01%

29,956

若有群聚相關需另做設計

上述是設計示例，並非本次已完成樣本。對實際批次和跨 process 故障，應同時報 per-run／per-batch zero-event coverage 與測試案例種類。形式化命題處理其明定模型中的所有有效輸入；實驗上界只處理抽樣到的環境，兩種證據不可互相替代。

延遲與多重比較

報 p50、p95、p99、max、timeout 和完成率；只算成功者延遲會掩蓋被卡住的工作。比較 queue、compose、validation、lock wait、write 與 retry 的分段時間；若不同 arms 的完成集合不同，再加 fixed-workload makespan。主要 RQ 事先排序，消融與探索性結果分標，避免從大量組合中只挑顯著結果。

全零 cluster 的普通 bootstrap 可能退化為 [0,0]，不能據此聲稱確定無風險。354 個樣本的 p99 尾端約只有 3.54 個點；應揭露樣本量和定義。不可平均每 run 的 p95／p99 後稱整體 pooled quantile。統計方法與 sample unit 應先登記。[10–12]

十二 分階段完成最小可信證據

下列是建議實驗計畫，並非已執行結果。先通過前一階段的驗收，再擴大量測；不必立刻跑所有參數的笛卡兒積。

表 10 最小方案及停止條件

階段

工作與輸出

通過條件

M0 規格與校正

凍結版本；列出支援 patch、狀態機、信任模型、oracle 與分母；更正舊表

所有主張有範圍與可測反例；基線和原始資料可定位

M1 單檔正確性

對 S1–S5 加入插刪、context、gap、重複 ID、stale base 與錯誤收據；小型枚舉與 property tests

被接受者完整輸出正確；被拒者未改檔；失敗不被收據掩蓋

M2 Harness 真接線

完整 compose 到 steward commit；串接 batch、retry、receipt；與獨立 oracle 對帳

每個 intent 追到終態；每筆時間可分解；無遺失事件紀錄

M3 配對 pilot

5 主臂含 lock、CAS retry、Git、bare composer 與完整 ATM，另加 3 診斷臂

重算表與原始檔一致；找出變異與瓶頸；不以 pilot 宣稱勝出

M4 最小主結果

預先固定 workload seeds 與 repetitions，含單 process 與多 process

同時報 correctness、coverage、goodput、tail latency 與 CI

M5 重現與決策

全新環境重跑；原稿、artifact、版本與 figures 對帳

可由一個入口重建主要表；據結果決定完整論文或經驗報告

建議的最小主矩陣

具體起跑設計可用 3 種 workloads（cold／低競爭、hot 且不相交、hot 混合衝突）× 2 拓撲（1 process × 8 workers、8 processes × 1 worker）× 5 主臂 × 10 workload seeds × 3 次重啟，共 900 runs；3 診斷臂只跑單 process，共 270 runs，合計 1,170。每 run 明定 1,000 offered logical operations，retry 另計。這是建議規模，不是已跑結果，正式 seed 數須由 pilot 調整。

另以 24 類 correctness families × 10 輸入 × API／CLI 雙入口，得到 480 scenario jobs；故障測試可用 8 cutpoints × 3 機制 × 10 seeds × 單／多檔，共 480 fault runs。三種 jobs 不同質，不能加成同一統計樣本數。

若任何 arm 出現資料破壞、oracle 不一致或收據對不上，不要繼續產生效能結論。先保存失敗工件、界定根因與受影響版本；修正後重新凍結 commit，重跑受影響的全部對照臂。

十三 完整論文需要的消融與圖表

消融必須解釋效果來自哪裡

表 11 機制消融及預期回答

比較

測量重點

使用限制

完整方法與舊循序套用

行數位移、輸入排列與成功範圍

舊方法可能錯誤，只作機制診斷

broker on 與 off

固定 composer 與提交路徑，測准入的淨增益與成本

避免將裸合併器收益全部歸給 ATM

context 保守策略與精確編輯範圍策略

安全性、false rejection、coverage

精確策略需先有規格與獨立 oracle

不同 compose windows 與 batch sizes

吞吐、tail latency、stale 與重提率

含 0 window 或可比序列基線

有無 retry 與不同 retry budgets

correct completion、liveness、額外 work

no retry 是受限臂，不能只報成功者

有無 registry CAS 與 apply lock

殘留 lease、TOCTOU、lost effects

明標 fault injection，與正常主比較隔離

有無驗證與角色檢查

validator 成本、拒絕原因、監測到的寫入

移除安全機制的臂不作可部署推薦

建議的主文圖表

• 圖 1　責任與狀態流程：平行 proposal、batch closure、同基底合成、驗證、受控 commit、reject 與 re-propose；以清楚邊界標出可信元件

• 圖 2　上方插入與下方修改的最小反例，加上同 gap、context 假衝突與 stale base 四例

• 表 1　v1 承諾、歷史實現、候選版本與新增研究貢獻；每列綁 commit 與驗證方式

• 圖 3　correct goodput 對 p95 latency 的 tradeoff；各點附 coverage 與 CI，不只畫 wall ratio

• 圖 4　completion outcomes 堆疊與 delay decomposition，讓 reject-all 和重試成本無處隱藏

• 表 2　正確性、unsafe acceptance、false rejection、零事件上界與跨 process 收據對帳

• 附錄　故障矩陣、seed 清單、逐 run 數值、Git 合併選項、版本與重現命令

完整實驗再加入多 repository、更多 patch 尺寸、長尾工作時間和偏斜熱點。真 LLM 執行會引入模型版本、token、prompt 與提案品質變異，應在 deterministic trace 主結果完成後另作外部效度評估。

完整主矩陣的示例為 hot ratio {0,0.5,1} × writers {2,8,16} × 衝突類型 3 檔 × process 模式 2 檔，54 cells；5 臂 × 20 seeds × 3 重啟，共 16,200 runs。window、file size 與 arrival rate 採定向 sweep；以 pilot 量到的時間估算預算，不用舊稿 2.5 秒外推。

十四 建議重寫架構與摘要示例

主文順序

1 問題與範圍 → 2 v1 承諾和歷史診斷 → 3 協定與信任模型 → 4 合成性質與實作 → 5 評估方法 → 6 結果與 tradeoff → 7 限制及相關工作 → 8 結論。冷熱准入、queue 和 registry 的舊結果放背景或附錄，除非它們直接回答新的主 RQ。

研究問題可以更有判別力

• RQ1　在明定的 patch 子集合與故障模型下，方法是否保持所有已提交有效編輯，並正確拒絕不相容提案

• RQ2　相對 lock、CAS retry 與 Git 合併，能安全完成多少工作，付出多少延遲、重試及拒絕成本

• RQ3　哪些 patch 結構、hotness、batch window 與 process 數造成效能或 coverage 轉折

• RQ4　治理收據和寫入入口能驗證到哪一層，哪些保證仍依賴合作式程序或 OS 權限

沒有虛構結果的摘要示例

多個程式代理對同一檔案提出修改時，寫入准入與最終整合是不同的正確性責任。本文研究單一治理域內，同一基底上的 patch 如何經過合成、驗證與受控提交，保留可相容的修改，並對不相容或過期提案回傳可對帳的結果。我們以 ATM 的既有 composer 與 steward 路徑為案例，區分歷史實作缺口、協定假設與尚待驗證的安全性質。

我們提出一個具明確 batch、base 與 retry 語意的合成提交契約，並在單檔、合作式 writer 及無歧義 patch 的限制下，給出決定性與編輯保留性的證明義務。評估設計以鎖定序列化、樂觀 CAS 重試與 Git 三方合併為比較基線，同時量測正確完成率、可處理範圍、拒絕、尾端延遲、重提成本及多 process 故障。主要結果須在凍結版本與可重現事件紀錄完成後填入；在此之前，本文不主張實驗已證明零遺失更新或任意語意正確。

這個版本適合提案或研究計畫。正式結果摘要應把最後兩句替換成實際 workload 規模、比較效果與 CI，並保留單檔／合作式 writer 等適用範圍，不把目標數值當結果。

十五 交付前清單與作者需提供的資料

優先完成

• P0　更正 @@ context 說明、排列穩定命名、transactional 與 identity 保證；核清 R1 分母

• P0　為歷史 baseline、candidate 與 final artifact 建立完整 SHA；標明各表實際使用哪一版

• P0　定義 logical operation 與 attempt、batch closure、commit acknowledgement、retry deadline 和失敗終態

• P0　建立獨立 oracle，驗證完整輸出、frame property、重複效果與收據對帳；報 reject-all 可揭露指標

• P1　加入 lock、CAS retry、Git 三方合併；固定共同 contract 與資源預算

• P1　用獨立 workload seeds 做配對重跑，公開原始整數、CI、故障工件與重現入口

• P1　完成跨 process、故障注入與 context false rejection 評估，再決定標題和投稿定位

請補一個可核驗的實驗封包

表 12 精確資料清單

資料

最低內容

版本 manifest

ATM 與 harness 完整 SHA、Git dirty 狀態、lockfile、Node／OS／硬體；每個 run ID 的設定

原始事件與終態

逐 proposal／attempt／batch／commit 事件；base 與 patch digest；最後檔案；失敗與 timeout 也保留

可執行入口

probe.mts、產生器、獨立 oracle、彙整腳本和一鍵重建主表命令

舊表來源

PAPER_V2_KEY_TABLES、HOT_FILE_LATENCY、composer probe 輸出，以及 T6／R1 每 run 的分子分母

重現清單

seed pairs、運行順序、warmup、timeout／retry、Git flags、expected fixtures 與 raw checksums

本審閱建議的下一步是先完成規格與資料校正，成本低且能避免整批實驗量錯問題。完成後，若正確強基線與 ATM 的差異仍有實務意義，再投入完整效能與多 repository 評估。若只得到同等安全但更高成本，也可以誠實呈現治理收據與責任分離的價值，前提是價值被定義並量測。

十六 核驗來源與引用範圍

以下均為一手來源；連結可直接開啟。原稿提供動機與作者報告數字，公開來源支持格式、方法、版本與文獻定位。這些引用都不取代缺少的原始 ATM 實驗工件。

[1] Eagl Huang  ATM  2026。arXiv:2607.00041v1，官方提交日期 2026-06-29。支持 v1 範圍、角色與既有承諾；不是本次重現。

[2] v1 框架 annotated tag。tag object 0b31aa8683b44b3a78206132a0bf90a0fde73d1c；peeled commit a897f144c84b66bb39f4f783c67e48ef75b7db78。

[3] ATM 歷史 text steward。commit 8dd6a1c6d169bf0421a55d3954a0a299b0bd582b；支持 sequential reduce 與固定 proof 欄位的程式判讀。

[4] 本次主線快照。commit 3b0f7660b6673ba6c7570ee31fa776c0fac89bb5。版本狀態截至 2026-10-07 11:49 UTC。

[5a] ATM 候選同基底 composer。固定 head 65e8aab36f79c335d542151133e931f7dd71e7c0；支持重疊與排列檢查判讀。

[5b] ATM 候選輸入檢查。與 [5a] 同一 SHA；actor 與 steward 標籤檢查的實際邊界。

[6] FileHeat PR 197。已合併版本與支援範圍；不支持 benchmark 成效推論。

[7] Native hot parking PR 199。已合併 ticket 與 resume 流程；官方 fixture 與外部 benchmark 範圍分開。

[8] Git 官方 git merge file。共同 base 三方合併、衝突與 exit status。

[9] Kung 與 Robinson  1981。On Optimistic Methods for Concurrency Control，ACM TODS 6(2)，213–226。

[10] NIST Exact Binomial Confidence Bounds。零事件上界的統計方法；不驗證 ATM 的獨立樣本假設。

[11] Kalibera 與 Jones  2013。Rigorous Benchmarking in Reasonable Time；支持分層變異與量測設計。

[12] NIST Percentiles。分位數定義與樣本計算口徑。

[13] Maxim Nikolaev  Claim Plane  2026。Enforceable Change Intents and Dynamic Scope for Parallel Coding Agents，arXiv:2607.21909v1。

[14] Maxim Nikolaev  Claim Plane follow up。Reliability Gains and the Limits of Selective Concurrency for Parallel Coding Agents，arXiv:2608.00947v1；後續確認研究。

[15] Ellis 與 Gibbs  1989。Concurrency control in groupware systems，SIGMOD，399–407；本次只核書目與摘要。

[16] Shapiro 等  2011。Conflict-free Replicated Data Types，SSS；收斂條件與研究模型。

[17] GNU Diffutils Unified Format。old hunk count 包含 context 與刪除行；不單獨證明 ATM parser 行為。

[18] SQLite Atomic Commit。以 crash 測試、同步寫入與恢復流程區分原子性；是方法參考，不是 ATM 保證。