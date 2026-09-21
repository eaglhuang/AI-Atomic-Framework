# ATM 外部產品驗證預註冊協議

狀態：`preregistered`。本文件只封存執行前規則；它不是產品效能或市場採用的宣稱。

## 假設與決策規則

- H1：ATM arm 不會漏放 oracle 標記的衝突，且不會把 benign-concurrency 轉成系統性 false block。
- H2：ATM arm 的完成率、重試與修復時間以獨立 oracle 的原始事件資料裁決；任何缺失成本或 token 資料維持 unavailable，不以模型估算補值。
- 結論門檻：兩個封存 repo、AB 與 BA 配對均完成後，才可比較完成率、false block、missed conflict、人工分鐘、tokens、billed cost、retries、repair time；p95 僅由原始 timestamp 計算。
- 排除規則：工作樹污染、repo SHA 漂移、workspace link、非公開 npm 套件、已洩漏的 hidden corpus、缺少 raw 成本遙測的 run 一律排除，不得替代為模擬值。
- 重試：只允許明示的環境故障重試一次；任何產品或治理失敗必須保留原始失敗並由 oracle 裁決。

## 封存工作負載

| Repo | Git SHA | 基線 arm |
| --- | --- | --- |
| `sindresorhus/p-map` | `bc26cf03f81292325236a1188063dac8e7a4de0f` | 真實 Git worktree + PR |
| `fastify/fastify` | `1beaf7e72d24b2fc63a02a7f5806772a00e45454` | 真實 Git worktree + PR |

兩者均以 `git ls-remote <url> HEAD` 取得 SHA；執行時必須重新檢查可 fetch 及封存 SHA，不得追隨 branch。

## Arm 與隔離

- baseline：真實 Git worktree、Git 操作和 PR；禁止 deterministic in-repo model。
- ATM：只接受公開 npm tarball（名稱、版本與 SHA-256 都要封存）；禁止 workspace link、local path 或 framework checkout。
- hidden corpus owner、adjudicator、baseline implementer、ATM implementer 必須是四個不同角色；oracle 在 run seal 前只對 custodian 可見。

## 本輪 stop condition

公開 npm 套件版本與 tarball digest、獨立 oracle 的接受證據、原始成本遙測尚未封存。因此 `manifest.json` 的 `runEligibility.eligible=false`，0008 不得執行也不得產生結果宣稱。這是可驗證的未就緒狀態，不是負面結果。

## 可重跑入口

```text
node --strip-types scripts/validate-external-benchmark-protocol.ts
node --strip-types tests/cli/external-benchmark-protocol.test.ts
```

執行前要將 manifest 的公開 npm 與 oracle 欄位重新封存並把 `runEligibility` 轉為 eligible；否則驗證器只證明「協議完整且正確封鎖執行」。
