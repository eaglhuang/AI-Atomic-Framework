# ATM 臂 preflight 紀錄

結論：**未通過**。`formal/protocol.json` 的 `atm` 臂維持 `status: "unverified"`，正式跑會拒跑。

環境：暫存 repo（以 `formal/seed` 複製），`node <framework>/atm.mjs setup --agents none --cwd <scratch>` 初始化成功。

| 步驟 | 指令 | 結果 |
|---|---|---|
| 初始化 | `atm.mjs setup --agents none --cwd .` | 通過（ATM_SETUP_READY） |
| 寫入 proposal | `atm.mjs broker proposal create --proposal-file p.json` | **失敗**：`Cannot find module 'ajv/dist/2020.js'`；在暫存 repo 補 `npm i ajv@8` 後變成 `ATM_BROKER_PROPOSAL_INVALID` |
| 驗證 proposal | `atm.mjs broker proposal validate --proposal-file p.json` | **失敗**：唯一的 issue 是 `missing-atom-refs`（需要 atom 註冊） |
| 產生 atom 參照 | `atm.mjs atomize inventory --cwd .` | **失敗**：`ATM_ATOMIZE_INVENTORY_FAILED`，找不到 `/tmp/atm-onefile-cache/.../scripts/src/atomize-inventory.js` |
| 產生 atom 參照 | `atm.mjs atomize backfill --cwd . --dry-run` | **失敗**：`ATM_ATOMIZE_BACKFILL_FAILED`，同樣找不到 scripts 模組 |
| 合併計畫 | `atm.mjs broker compose --proposal-file p-mul.json --proposal-file p-div.json` | 通過（`ATM_BROKER_COMPOSE_PLANNED`），正確判出同檔尾端衝突：`verdict: needs-steward` |
| steward plan/apply | 未執行 | 因 proposal 無法通過驗證而卡住 |

## 觀察（ATM 新手成本的數據）

1. 獨立執行 ATM 的暫存 repo 需要自行安裝 `ajv`，runner 本身不帶它。
2. `atomize` 的 inventory/backfill 在 onefile 版本中缺少 scripts 模組，因此 adopter repo 無法產生 atom 參照。
3. 沒有 atom 參照，`broker proposal create` 就無法通過驗證。這是 preflight 的實際阻塞點。
4. `broker compose` 不要求 atom 參照，能正確偵測同檔衝突，但它不足以代表整合成功。

## 解除條件（三者都要滿足才能把 status 改為 verified）

- `atomize inventory`／`backfill` 在暫存 repo 能跑通並產生 atom 參照，或另外提供可替代的 atom 註冊路徑。
- `broker proposal create` 與 `validate` 通過。
- `broker steward plan`／`apply` 能把兩個衝突 proposal 整合到 integration worktree，並通過 oracle。

`arms/make-proposal.mjs` 會從 writer 分支的 diff 產生 `atm.patchProposal.v1`，供上述流程使用。
