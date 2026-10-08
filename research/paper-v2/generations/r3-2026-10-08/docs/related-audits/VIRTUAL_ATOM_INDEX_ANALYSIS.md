# 無改原始碼自動原子化：Shadow Atlas vs Virtual Atom Index

日期：2026-10-06（Asia/Taipei）

## 結論（一句）

旁邊放 `XXX.cs.atm` **可行但不是最好**；集中式 Shadow Atlas **方向對**，但 ATM 更該做成 **Virtual Atom Index（VAI）**：以既有 `AtomCandidate`→確定性 `atomCid` 為主鍵、符號＋內容雜湊為定位、Atomic Map 管跨檔關係——預設只寫 `.atm/`，物理重構另開 opt-in。硬傷不是「沒拆檔」，而是 **發現了候選卻沒有預設持久化進 claim／compose 路徑**。

## ATM 架構裡真正吃紅利的是什麼

INV-ATM-010 compose-first：共享物理檔可 compose；工人宣告 **atom／CID／content-anchor／source-range**，broker＋composer 裁決。紅利來自 **穩定語意身分＋邊界**，不是檔案是否被切開。

已有（勿重造）：

- `discoverAtomCandidates`（JS／Python；另有 `language-csharp` 包）
- `candidatesToWriteIntent`：CID = hash(kind‖symbol‖sourcePaths‖detectionMethod)
- `VirtualAtom`／`enclose` 契約（JS／Python 的 enclose 仍 missing → partial）
- Atomic Map＋map curator（跨檔組合／拆分提案）
- `AtomizationPlan.dryRun: true` 強制（物理改碼本就是審核後才可）

缺口：

- 預設開發流不會把候選 **持久化** 成可 claim 的原子目錄
- enclose 未落地 → Layer-1 虛擬邊界弱
- 粗 owner map 仍易撞；拆分靠 curator 提案而非自動
- 新人體感「原子化＝改原始碼／開工單」

## 對 `XXX.cs → XXX.atm` 旁掛

同意四點風險：rename 失聯、行號脆、目錄噪訊、跨檔 Map 表達差。旁掛只適合作 **IDE 投影**，不當 source of truth。

## Shadow Atlas：夠好，但不完整

優點：不碰原始碼、符號定位、close 時增量、Map 獨立、重構 opt-in——與 ATM 對齊。

不足：

1. 若以 path 鏡像為主鍵，仍弱於 **CID 主鍵**（ATM broker 已經用 CID 認同一語意單元）。
2. 易與 `atomic-registry`／workbench **雙檔真相** 漂移。
3. 每個 function 都進 atlas → claim 過細；需 confidence／kind 門檻。
4. 只靠 close 太晚；claim／next 時對 touched files lazy refresh 更貼並行開發。
5. AI 描述若混進身分會污染 CID；必須分層：deterministic identity vs advisory annotation。

## 更建議：Virtual Atom Index（VAI）

| 層 | 內容 | 寫哪 |
|----|------|------|
| L0 即時 | discover → WriteIntent（現況） | 不落盤也可 admission |
| L1 Index | 持久化候選：`atomCid` 主鍵 + symbol + paths + contentHash +（range 僅快取） | `.atm/atlas/index.json`（或分片） |
| L2 Map | 跨檔依賴／組合 | 既有 atomic map／registry |
| L3 註解 | AI 職責說明、信心 | `.atm/atlas/annotations/`（不可當 gate） |
| L4 物理 | `atomize --refactor` → dry-run plan → 任務卡 | 明確 opt-in |

規則：

- 身分 = CID（與 candidate-bridge 同一公式）；path／symbol 是可重綁 locator。
- hash 不符 → `stale`／needs-reconfirm，不靜默沿用。
- 同 actor 細編輯不強制升「熱原子」；claim 粒度用 high-confidence symbols。
- 旁掛 `.atm` 檔 = 可選投影自 Index，不是主存。

## 優缺取捨（對 ATM）

拿得到：同檔不同符號 compose、影響範圍、任務卡寫 atom id、新功能開發自然長出索引。

拿不到：god-file 可測性（仍要 opt-in 重構）；無 adapter 語言 fail-closed；低信心候選不能自動 parallel-safe。

相對 Shadow Atlas 的增量價值：接上既有 ASP／CID／Map／dryRun，少一條平行系統，論文／新人敘事一致——「虛擬原子索引補齊自動原子化，物理原子化是進化而非前提」。

## 導入順序（修訂）

1. Persist discover 結果 → VAI；doctor 顯示 stale。
2. claim／compose／WriteIntent 優先吃 VAI atomCid（touched files 先 refresh）。
3. 補 JS／TS `enclose()`；再強化 Python／C#。
4. taskflow close 增量更新 + experience-loop 可提案「升成 registry atom」。
5. `atomize --refactor` 獨立產品路徑。


## 附錄：對照原始碼後的補強（2026-10-06 架構 brief）

- ATM **已經可以**不改 production source 做登記／backfill（`atomize backfill`、`planAtomize` 強制 dry-run）；缺口是 **細粒度身分自動綁進 admission**，不是「能不能不动原始碼」。
- 既有粗覆蓋：`atomic_workbench/atomization-coverage/path-to-atom-map.json`（path→owner atom），不是 region／symbol 級。
- **content-anchor**（`preimageDigest`＋可選 symbol／astPath）已是「符號＋內容雜湊、行號只是解析輔助」；rename → `stale` 需 re-anchor。VAI／Atlas 應直接延展這層，勿另發明定位語意。
- Claim 允許 **空 `atomRefs`、只有 targetFiles** → 新功能自動原子化必須把「有錨才算完整 intent」變成預設，否則紅利仍弱。
- 勿用 replacement-lane 的 **shadow** 命名 Atlas；建議 `atlas`／`region-index`。
- `.atm/atlas` 本身是 **shared surface**：多 agent 寫 meta 也要 ticket／steward，不能當無治理旁路。
- 可選 per-file `*.atm` = 由 Index **生成的唯讀投影**；權威仍在 registry＋atlas／coverage shards。
