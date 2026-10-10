# A1 — 版本錨點表（ATM 論文 v2 實驗）

| 欄位 | 內容 |
|------|------|
| 產出 | A1（`EXPERIMENT_CHECKLIST.md`） |
| 核對時間 | 2026-10-07 20:16 Asia/Taipei（CST, UTC+8） |
| Repo | `eaglhuang/AI-Atomic-Framework` |
| 核對工具 | `cursor-github`：`get_tag`／`get_commit`／`get_pull_request`／`get_issue`／`list_tags`；輔以公開 GitHub REST；本機 blob：`sha256sum`＋`diff -q` |
| 約束 | **CI 綠／PR 合 ≠ 主實驗完成**。下表只凍結「論文／實驗引用哪一版碼」，不宣稱 RQ 主結果已跑完。 |

---

## 1. 錨點總表

| 對象 | 完整 SHA（或 short＋註） | 角色 | 論文如何用 | 核對方式與時間（Asia/Taipei） |
|------|--------------------------|------|------------|------------------------------|
| **Annotated tag `v0.9.0-alpha.1`（審閱稱「v1 框架 annotated tag」）** | Tag object `0b31aa8683b44b3a78206132a0bf90a0fde73d1c` → peeled commit `a897f144c84b66bb39f4f783c67e48ef75b7db78` | historic（v1 範圍／角色／既有承諾） | 引用 arXiv:2607.00041 與「v1 框架」時的**產品語意錨**；**不是**本次 co-write 主實驗碼基。Tag 名為 `v0.9.0-alpha.1`，**沒有**名為 `v1`／`v1.0.0` 的 ref（404）。 | `get_tag(v0.9.0-alpha.1)`；`get_tag(v1)`／`v1.0.0` → Not Found。2026-10-07 20:16 CST |
| **Annotated tag `v0.1.17`** | Tag object `47697ae528a529ef67c8a20c88f3e97d2b98fe18` → peeled commit **`8dd6a1c6d169bf0421a55d3954a0a299b0bd582b`** | historic（冷熱／探針／動機數字） | 舊表 T1／T6／V017、composer 探針紅燈基準、issue #196「已重現」列；論文動機「stale ≈55–65% lost」對照用此世代 harness／ATM。 | `get_tag(v0.1.17)`；`list_tags`。本機樹：`/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`（無 `.git`，以 tag peel 為準）。2026-10-07 20:16 CST |
| **`main` tip（截至核對當下）** | **`3b0f7660b6673ba6c7570ee31fa776c0fac89bb5`** | main（含已合 #197＋#199） | 「目前上游主線」快照；**可**引用 FileHeat／native hot parking 已合入狀態。**不可**當成 composer 同 base 合成已修完（#198 未合）。審閱聲稱 main=`3b0f7660…`（截至 2026-10-07）**與本次 API 一致**。 | `get_commit(main)`＋`get_commit(3b0f7660…)`；message = Merge PR #199。Committer 2026-10-07T11:38:52Z → 19:38 CST。核對 20:16 CST |
| **PR #197 FileHeat（已合）** | Merge commit `e867a195cdc42ff92e1412119a6d1cc8d48751fe`；head `1b15bfdade63b24989aa94cfd565e6d9848f66c6` | main 祖先（路由偏置） | 支撐「熱檔 admission／溫度」敘事；**不支持** lost-update／composer 正確性主主張。預設 `ATM_HEAT_MODE=static`。 | `get_pull_request(197)`：`merged=true`，`merged_at` 2026-10-07T07:30:02Z。2026-10-07 20:16 CST |
| **PR #199 native hot parking（已合）** | Merge commit = **main tip** `3b0f7660b6673ba6c7570ee31fa776c0fac89bb5`；head `e1b5abe7885fc047129a604f78e5545dbfb82b6d` | main（可恢復熱衝突 park） | 支撐 ticket／resume／queue 敘事；PR 正文自承 **atm-bench 外部 benchmark 未跑完**。CI 綠＋合入 ≠ 主實驗完成。 | `get_pull_request(199)`：`merged=true`，`merged_at` 2026-10-07T11:38:52Z。2026-10-07 20:16 CST |
| **PR #198 composer＋steward（已合）** | Merge **`5692474f7db70ab52a7a71c8af4867609e7e4b43`** on `main` | candidate→main | M1 P0-1..4 已合：同 base 合成、blocked 收據、identity gate、S1–S3。Harness C1 用此 SHA 作 `ATM_MONOREPO`。 | merged 2026-10-07；本機樹 `/workspace/atm-main-5692474f/…` |
| **Issue #196** | N/A（追蹤單） | spec／驗收契約 | P0 範圍、S1–S4、非目標、探針表；實作與論文措辭對齊以此為準。 | `get_issue(196)`：`state=open`，labels bug＋enhancement＋help wanted。2026-10-07 20:16 CST |
| **Final artifact（主結果碼）** | **candidate: `5692474f…`；final TBD** | candidate→final pending review | E ladder DRAFT done；**candidate final pin**＝#198 merge `5692474f7db70ab52a7a71c8af4867609e7e4b43`＋harness steward＋C3 oracle。升 **final** 須外部審核／稿凍結；**不** npm publish／tag。 | 2026-10-07 23:30 CST |
| **本機 `/workspace/AI-Atomic-Framework` checkout** | `ed317820ddd53a20680fe002f3c68b8158e8dfd7` | local stale checkout（**不是** current main） | **禁止**當「GitHub main 現況」引用。僅作舊工作樹。 | 本機 `git rev-parse HEAD`。2026-10-07 20:16 CST |

---

## 2. Text steward blob 註記（historic vs 多份本機樹）

| 路徑 | `sha256` of `packages/core/src/broker/steward-transactional-apply.ts` |
|------|---------------------------------------------------------------------|
| `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17/.../steward-transactional-apply.ts` | `2b9328a1dd11a3f465748d0cc502033629cc7d6ffe5bf1f991a36602089e9350` |
| `/workspace/AI-Atomic-Framework/.../steward-transactional-apply.ts`（`ed317820`） | **同上** |
| `/workspace/atm-main-test/AI-Atomic-Framework-main/.../steward-transactional-apply.ts` | **同上** |

- `diff -q`：v0.1.17 樹與 `/workspace/AI-Atomic-Framework` **相同**。
- 與 issue #196／實作計畫一致：到 **main tip 合入 #199 為止**，公開敘事仍是「text 路徑為 sequential reduce」；**修正在 candidate #198**，不在 historic／未合入前的 main。
- **注意**：本核對比的是**本機檔案 blob**；未對 GitHub 上 `main` tip 的 blob API 再抓一次 raw file。若日後 main 合入 #198，此列必須重算並改角色。

---

## 3. 強制聲明（寫進稿／表腳）

1. **CI 綠／PR 合 ≠ 主實驗完成。** #197／#198／#199 已合；C1–C4＋**D1–D5** 已完成（RQ2 main = `--arm steward`）。B5–B8（S4／邊界／排列／S5）已於 2026-10-07 22:43 CST 收尾（`runs/b5-b8/`）。主實驗：**E2 主矩陣 done**（2026-10-07 22:55 CST，`runs/e2-matrix/`，DRAFT — 不宣稱勝出）；F3 封包／reproduce **done**；**E3／E4 done**（DRAFT）；E5 done（DRAFT）；**candidate final pin**＝`5692474f…`（待審核升 final）。
2. **Candidate ≠ Final。** #198 已合；D5 已凍結 harness 主方法調用；主文數字仍須標所跑 SHA，且與 final TBD 分離。
3. **Historic 探針紅燈**（`runs/composer-probe/probe.out`）綁 **v0.1.17 / `8dd6a1c6…`**，用來動機與 M0 紅燈，**不是**修後綠燈證據。
4. **packages/*/package.json 仍可能寫 0.1.2**：產品世代以 **git tag `v0.1.17`** 為準（見 `PAPER_V2_KEY_TABLES.md`／`PAPER_V2_EXPERIMENT_NOTES.md`）。

---

## 4. 建議稿內縮寫列（可貼論文）

| 簡稱 | SHA | 用途 |
|------|-----|------|
| ATM-v1-tag | peel `a897f144…`（tag obj `0b31aa86…`，名 `v0.9.0-alpha.1`） | v1 框架 |
| ATM-historic | `8dd6a1c6…`（tag `v0.1.17`） | 探針／舊冷熱表 |
| ATM-main-2026-10-07 | `3b0f7660…` | 當日 main（含 #197/#199） |
| ATM-cowrite-candidate | `65e8aab3…`（PR #198） | 同 base 合成候選 |
| ATM-final | TBD | 主結果凍結 |

---

## 5. 更新（2026-10-07 約 21:10 Asia/Taipei）

- PR **#198** 已 **merged**（`merged=true`）。merge commit **`5692474f7db70ab52a7a71c8af4867609e7e4b43`**。
- 合入前 head（update-branch 後）`3b8d62a5d407f5e4fd11f5d73b2c07757af14926`；獨立驗收曾在 `65e8aab3…` 上跑過。
- Issue **#196** 已 closed。
- **仍不** npm publish／不打 tag；`ATM-final` 仍 TBD（需 E 主矩陣數字；RQ2 調用已於 D5 凍結為 `--arm steward`）。
- 引用 cowrite 能力時改用 **main tip（含 #198）** 或明確 pin merge SHA；勿再寫「#198 未合」。

## 5. Harness C1 pin（**done** 2026-10-07 21:17 Asia/Taipei）

| 用途 | SHA / 路徑 |
|------|------------|
| ATM_MONOREPO for `--atm-writer steward` | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（#198 merge） |
| 本機展開 | `/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| Smoke | `runs/steward-c1-smoke/`；筆記 `runs/steward-writer/STEWARD_WRITER_C1.md` |
| Final artifact | 仍 TBD（需 C2–C4／D／E 主矩陣） |


## D5 — RQ2 main-method freeze (2026-10-07 21:35 CST)

| Item | Value |
|------|-------|
| Main arm | `--arm steward` only (`arm_role=main_method`, `rq=RQ2`) |
| ATM_MONOREPO | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| Frozen invoke | `--arm steward --atm-backend real --compose-window-ms 100` |
| Summary | `runs/baselines/D5_SUMMARY.md` |
| D ladder | **complete** |
| B5–B8 | **done** 2026-10-07 22:43 CST |
| E1 pilot | **done** 2026-10-07 22:50 CST → next **E2**（不自動開工） |


## B5–B8 — B ladder closeout (2026-10-07 22:43 CST)

| Item | Value |
|------|-------|
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| Evidence | `runs/b5-b8/`（probe／EXPECTED／B5–B8.md／SUMMARY／stock／checksums） |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_B5_B8.md` |
| Result | B5–B8 **pass**; B ladder **complete** |
| Next | **E2** 主矩陣（E1 pilot done；不宣稱勝出） |
| ATM sources | untouched (read-only pin) |

## E1 — Pilot matrix (2026-10-07 22:50 CST)

| Item | Value |
|------|-------|
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（read-only） |
| Main arm | `--arm steward` + `compose-window-ms=100` |
| Matrix | 3 workloads × 5 arms × seeds `{11,17,23}`（45 cells） |
| Evidence | `runs/e1-pilot/E1_SUMMARY.md`；`e1_compare_raw.json`；`WORKLOADS.md` |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_E1.md` |
| Banner | **pilot only — no win claims / no RQ2 main result** |
| Next | **E2**（default only；do not auto-start） |
| ATM sources | untouched |

## 6. E2 matrix（2026-10-07 22:55 Asia/Taipei）

| 用途 | 路徑／內容 |
|------|------------|
| Seed registry（跑前） | `runs/e2-matrix/SEEDS_REGISTERED.md`＋`seeds.json` |
| Matrix | 3 wl × 5 arms × 10 seeds＝150；`--scheduler-seed = seed+1000` |
| Summary | `runs/e2-matrix/E2_SUMMARY.md`（**DRAFT — not a win claim**） |
| ATM pin | 仍 `5692474f…` 唯讀 |
| Final | 仍 TBD |

## 7. F3／gaps 封包（2026-10-07 23:15 Asia/Taipei）

| 用途 | 路徑／內容 |
|------|------------|
| artifact_manifest | `artifact_manifest.json`（含 `atm_sha`／tree fingerprint／oracle_sha；DRAFT banner） |
| reproduce | `REPRODUCE.md`＋`reproduce.sh`（預設 verify-only） |
| checksums | `checksums.sha256` |
| logical_id | harness 解耦；見 `runs/steward-writer/STEWARD_WRITER_GAPS.md` |
| Final | 仍 TBD（E3+） |
| ATM sources | untouched（read-only pin） |

## 8. E3 window sweep（2026-10-07 23:17 Asia/Taipei）

| 用途 | 路徑／內容 |
|------|------------|
| Seed registry（跑前） | `runs/e3-sweep/SEEDS_REGISTERED.md`＋`seeds.json` |
| Window grid | `0, 25, 50, 100, 200, 400` ms |
| Matrix | steward 3×6×5＝90 + bare_composer hot_conflict 6×5＝30 → **120** |
| Summary | `runs/e3-sweep/E3_SUMMARY.md`（**DRAFT — not a win claim**） |
| ATM pin | 仍 `5692474f…` 唯讀 |
| Final | 仍 TBD |
| Next | **E4**（不自動開工） |

## 9. E4 multi-process（2026-10-07 23:26 Asia/Taipei）

| 用途 | 路徑／內容 |
|------|------------|
| Seeds | `runs/e4-multiprocess/SEEDS_REGISTERED.md`＋`seeds.json` |
| Matrix | procs 2/4/8 steward cas+lock；SP baseline；fault naive／nolock → **18** cells |
| Summary | `runs/e4-multiprocess/E4_SUMMARY.md`（**DRAFT**） |
| Invariants | main zombie=0；receipt_ok；proposer_direct_writesΣ=0 |
| Final | 仍 TBD |
| Next | **E5**（不自動開工） |

## 10. E5 fault injection（2026-10-07 23:29 Asia/Taipei）

| 用途 | 路徑／內容 |
|------|------------|
| Summary | `runs/e5-fault/E5_SUMMARY.md`（**DRAFT**） |
| Cells | 18（12 probe＋6 harness） |
| Terminals | blocked／rolled-back／recovery-required |
| E ladder | **A–E complete（DRAFT）** |
| Candidate final pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43` — **待外部審核／稿凍結後才升 final**（不 npm publish／不打 tag） |
| Next | F1／F2 表圖＋外部審核包 |

## r2 更新（2026-10-08 CST）

| 項目 | 內容 |
|------|------|
| ATM pin | 不變：`5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀；candidate final pin **仍 pending review**，E4 反例使其**不可**升 final） |
| Harness | r2：`src/oracle_v2.mjs`（新）、`steward-writer.mjs`／`runner.mjs`／`mp-worker.mjs`／`cli.mjs`（steward apply 遙測、worker 前綴 batch id、`--steward-apply-lock`，預設 off＝重現 r1） |
| Evidence generation | r1＝`research/paper-v2/generations/r1-reviewed-2026-10-07/`（封存不改）；r2＝`generations/r2-2026-10-08/` |
| 重現指令 | `reproduce.sh verify|analyze|rerun|seal`（r1 會改寫指紋的 verify 已移除） |

## r3 更新（2026-10-08 CST）

| 對象 | 內容 |
|---|---|
| PR #213 | 「fix(steward): close concurrent lost updates on canonical commit」；merged 2026-10-08T02:38:17Z（10:38 Asia/Taipei）by cursor[bot]；merge `bea35380d7f381f998c9930fa95f01b999c7f208`；head `4d7c9ed6287173f6f704e8d0a0d8a99683776bff`；base main `53e6fdb0fca462212c7d1a26dcdfa74653cf4436`；7 files、+875／−60（`cursor-github get_pull_request`，2026-10-08 10:40 CST 核對） |
| r3 pin 安裝 | 與 5692474f 相同機制：GitHub commit tarball（codeload）解壓至 `/workspace/atm-main-bea35380/`，`node_modules` 為相同 5 個 symlink（ajv 8.20.0 等）；以 `ATM_MONOREPO` 逐 run 選擇。無 clone／tag／publish |
| tarball | bea35380：36,081,328 bytes，sha256 `9346e5b175b176618f435aeb4b41ab93ef7575f9bf77d77c47a5aeac87ad34b5`，內嵌 commit＝`bea35380d7f381f998c9930fa95f01b999c7f208`；5692474f：36,053,896 bytes，sha256 `1d498a397e6a5db119d40b8f539dc165cb0028fbfe9577f953023f8ec8d45795`，內嵌 commit 相符 |
| packages/core/src tree sha256 | 5692474f `154fee8744e39fe1853dddf9a8f8bd1404efcd5831285020b989dd33064af20b`（433 檔）；bea35380 `38029e76ab2a91fcb88bd9a8b4ad63663c84289b2c656d7ed9edfec2845889d3`（434 檔） |
| core 差異 | 只有 `broker/steward.ts`、`broker/steward-transactional-apply.ts`（改）與 `broker/steward-commit-guard.ts`（新）；完整 diff `runs/r3-validation/ATM_CORE_DIFF_5692474f..bea35380.patch`。其餘差異在 cli／tests／docs／scripts，harness 不載入 |
| 版本標籤 | 兩 pin 的 `packages/core/package.json` 皆為 0.1.2；以 meta `atm_version` 的來源路徑（含完整 SHA）辨識 |
| 樹完整性 | 兩 pin 解壓樹與各自 tarball 逐檔比對：bea35380 0 差異；5692474f 只多一個空目錄 `.atm-temp`（2026-10-07 22:42 由 ATM 執行時建立），無原始碼差異 |
| 角色 | bea35380＝r3 驗證 pin（**不是** final frozen artifact）；5692474f 結果與安裝保留不動 |

## r4 更新（2026-10-08 CST）

| 對象 | 內容 |
|---|---|
| PR #214 | 「fix(steward): rebase disjoint region edits after hash drift」；created 2026-10-08 14:16:59、merged 14:27:12 Asia/Taipei by cursor[bot]；merge `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`；feature `b5729456bc14d9bf4c8acfce7be320fec691fee2`；base main `8b3622b7`；11 files、+965／−36 |
| CI（另列） | PR #214 CI：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate green（feature 14:17–14:26、merge 14:27–14:39 Asia/Taipei）；只跑框架測試，不重跑論文實驗 |
| r4 pin 安裝 | 與前兩 pin 相同機制：GitHub commit tarball（codeload）解壓至 `/workspace/atm-main-2118bc66/`，`node_modules` 為相同 5 個 symlink；以 `ATM_MONOREPO` 逐 run 選擇。無 clone／tag／publish；5692474f／bea35380 保留 |
| tarball | 2118bc66：108,077,954 bytes，sha256 `aa959607c35c51b7fc3c4e3d81b3d9e979ee62f4d9361ef9e9f5ee72e78abd88`，內嵌 commit 相符（tarball 較大是因 repo 內含 `research/paper-v2/` r1–r3 generations） |
| packages/core/src tree sha256 | 2118bc66 `a5492cff082327b08fb8736d9877fa084ce5748399430daab9dc6c455260f316`（435 檔）；bea35380、5692474f 同 r3 |
| core 差異 | `broker/steward.ts`、`steward-transactional-apply.ts`、`steward-commit-guard.ts`、`steward-base-composer.ts`、`steward-input-validation.ts`（改）與 `steward-region-rebase.ts`（新）；完整 diff `runs/r4-validation/ATM_CORE_DIFF_bea35380..2118bc66.patch` |
| 樹完整性 | r4 run 前後三 pin core 樹 hash 不變；2118bc66 解壓樹與 tarball 逐檔比對 0 差異 |
| repo 內 paper-v2 | 2118bc66 的 `research/paper-v2/generations/r3-*/SHA256SUMS` 與本機 r3 封存一致（sha256 `7a8c0cb4…`）；其 `EVIDENCE_INDEX.md` 為 r4 提案的基底 |
| 角色 | 2118bc66＝r4 驗證 pin（**不是** final frozen artifact） |

## r5 更新（2026-10-08 CST）

| 對象 | 內容 |
|---|---|
| PR #216 | 「fix(steward): keep live cross-namespace lock holders and queue applies」；created 2026-10-08 17:14、merged 17:30 CST by cursor[bot]；merge `37847584e24afc08ea58cfe380bb5b1220fbe335`（parents `44a9ee19`、`5e39ee12`）；feature `5e39ee1244ed47b3fd3f44f9553fcd690f003894`；未 tag、未 publish |
| CI（另列） | feature head：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate green（17:14–17:28 CST）；merge：四項 green（17:30–17:45 CST）；只跑框架測試，CI 記錄無法證明跨 namespace 測試真的互鎖 |
| r5 pin 安裝 | GitHub commit tarball 解壓至 `/workspace/atm-main-37847584/`，`node_modules` 同 5 個 symlink；以 `ATM_MONOREPO` 逐 run 選擇；queue on／off 以 `ATM_STEWARD_APPLY_QUEUE` 逐 run 設定 |
| tarball | 37847584：142,081,077 bytes，sha256 `e17a90ddceaf3c70d580c96e31f14cf8251d5a664985c1eb494f0d8db8045e3d`，內嵌 commit 相符 |
| packages/core/src tree sha256 | 37847584 `05d048dba20d3c9e1c002f457d68ec86a11651aafdde6f93023a0b2878810c37`（437 檔）；2118bc66、bea35380、5692474f 同 r4 |
| core 差異 | `steward.ts`、`steward-commit-guard.ts`（改）；`steward-kernel-lock.ts`、`steward-apply-queue.ts`（新）；`runs/r5-validation/ATM_CORE_DIFF_2118bc66..37847584.patch` |
| 樹完整性 | r5 前後四 pin core tree 與 broker 關鍵檔 hash 不變；37847584 樹內未產生 runtime 鎖／佇列目錄 |
| 角色 | 37847584＝r5 驗證 pin（**不是** final frozen artifact） |

## r6 更新（2026-10-09 CST）

| 項目 | 內容 |
|---|---|
| PR #238 | 「fix(broker): fall back when the steward apply queue is busy」；created 2026-10-09 17:00、merged 17:27 CST by cursor[bot]；merge `b35a6141bd5bfbaec654f1cd3079323581b04074`（base `3878cde9`）；feature `2712c0243aa2dcc30983ef10d8947ff7d4978721`；未 tag、未 publish |
| r6 pin 安裝 | GitHub commit tarball 解壓至 `/workspace/atm-main-b35a6141/`，`node_modules` 同 5 個 symlink；以 `ATM_MONOREPO` 逐 run 選擇 |
| tarball | b35a6141：197,301,078 bytes，sha256 `93fa7839d8e0fee51e5ad224833df2b57397fead3e77e0528117f21f5d5e59ef`，內嵌 commit 相符 |
| packages/core/src tree sha256 | b35a6141 `455f4b693746dbb37581b9af2c42ffab702b9693e6ab348cc3f39544c4591316`（438 檔）；37847584 同 r5 |
| CI（另列） | feature head 與 merge 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green |
