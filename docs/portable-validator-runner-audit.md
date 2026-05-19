# Portable CLI Validator Audit Report（暫態）

> 目的：盤點 `scripts/validate-*.ts` 中與 ATM CLI 有關的驗證器，統一是否可使用
> `runAtmJsonPortable(...)`。

更新時間：2026-05-19（由 `scripts/validate-*` 全量掃描 + 逐檔確認）

本次盤點基準：目前已知可直接執行 ATM CLI 並解析 JSON 的 validator 風格。

## 1) 已可用 Portable Runner（已完成）

這三個檔案已經使用 `runAtmJsonPortable`（或同等邏輯）並能直接切換到可攜式 fallback：

| 文件 | 目前模式 | 目前可用狀態 |
|---|---|---|
| `scripts/validate-experience-loop.ts` | `runAtmJsonPortable` | 已可用 |
| `scripts/validate-guide.ts` | `runAtmJsonPortable` | 已可用 |
| `scripts/validate-guidance.ts` | `runAtmJsonPortable` | 已可用 |

## 2) 其他 CLI validator 候選（應納入可攜式化）

下列檔案目前會以 `spawnSync` 或自定義 run 封裝呼叫 ATM CLI，邏輯上可遷移到 portable 風格；
但目前尚未完成、或因其他子行為混雜而需先理順：

| 文件 | 目前呼叫方式 | 建議 |
|---|---|---|
| `scripts/validate-cli.ts` | `runAtm()` 自訂封裝 + `spawnSync(process.execPath, [fixture.entrypoint, ...])` | 可遷移為通用 helper；需先保留 `fixture.entrypoint` 可變入口 |
| `scripts/validate-bootstrap.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-bridge-minor.ts` | `spawnSync(... + [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-examples.ts` | `run(process.execPath, [...])` + `npm` 呼叫 + 多段 helper | 可遷移，但需先理順 `npm`/測試範例流程 |
| `scripts/validate-external-golden.ts` | `spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-governance-commands.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-git-head-evidence.ts` | 自訂 `run()` + 多種 ATM 子命令 | 可遷移（先抽共用 helper） |
| `scripts/validate-git-hooks-enforcement.ts` | 自訂 `run()` + `node atm.mjs` + shell 檢查 | 可遷移（需保留跨平台 fallback） |
| `scripts/validate-meta-schema.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` + fixture 測試 | 可遷移 |
| `scripts/validate-migration-fixtures.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-multi-agent-confidence.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` + 其他腳本執行 | 可遷移 |
| `scripts/validate-neutrality-scanner.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-onefile-release.ts` | `runOnefile(entrypointPath, ..., args)` | 可遷移；建議保留 onefile runner wrapper 的測試特性 |
| `scripts/validate-root-drop-release.ts` | `spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-script-parity.ts` | 自訂 `run()` + `sh` 驗證 + ATM 主命令 | 可遷移；需同時保留 shell parity 分支 |
| `scripts/validate-seed-registry.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-seed-spec.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-self-hosting-alpha.ts` | `spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-skew-matrix.ts` | `spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'atm.mjs'), ...])` + 其他 TS 腳本 | 可遷移，先分離「CLI 測試」與「腳本輸出」 |
| `scripts/validate-upgrade-rollback.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-version-compatibility.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |
| `scripts/validate-upgrade-proposal.ts` | `spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...])` | 可遷移 |

## 3) 非執行器（只做訊息/規格/樣板檢查）

這些檔案雖然含 `node atm.mjs` 或 `atm.mjs` 文字，但主要在驗證文件片段、樣板欄位，不是 CLI 行為本體：

| 文件 | 主要用途 |
|---|---|
| `scripts/validate-charter.ts` | 驗證文件字串與章程模板一致性 |
| `scripts/validate-governance-local.ts` | 驗證建議 prompt/自動指令字串 |
| `scripts/validate-integration-adapter.ts` | 驗證 adapter metadata（含 first command 字串） |
| `scripts/validate-rollout-metrics.ts` | 驗證 adapter 指令欄位 |
| `scripts/validate-skill-templates.ts` | 驗證 skill 模版 handoff 字串 |

## 4) 下一步建議（一次性批次）

1. 先補齊 `validator-harness` 共用導出（`runAtmJsonPortable`）到上述「可遷移」清單中的檔案。
2. 優先處理不帶額外 shell/測試混雜、且行為單純的檔案（如 `bootstrap/governance-commands/external-golden`）。
3. 對 `onefile-release` / `root-drop-release` / `script-parity` 先保留獨立封裝再漸進切換，避免破壞現有 release 行為。
4. 這份清單每次有 validator 大改後應同步更新。

> 版本註記：此報告為當前盤點快照，後續每次改完 1-2 支 validator 後請回填修正狀態。
