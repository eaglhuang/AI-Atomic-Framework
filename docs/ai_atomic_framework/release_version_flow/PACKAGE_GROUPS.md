# Package Groups

本文件定義 ATM monorepo package group 與 fixed release train 規則。

## 1. Group 定義

| Group | Scope | 預設版號 |
| --- | --- | --- |
| `core` | `packages/core/**`, `schemas/**`, `compatibility-matrix.json` | fixed frameworkVersion |
| `cli` | `packages/cli/**`, `atm.mjs` | fixed frameworkVersion |
| `plugin-sdk` | `packages/plugin-sdk/**` | fixed frameworkVersion |
| `adapter` | `packages/adapter-*`, `packages/integration-*`, `packages/language-*`, `packages/plugin-*` | fixed frameworkVersion |
| `agent-pack` | `packages/agent-pack-*`, integration templates | fixed frameworkVersion |
| `docs` | public docs, migration guides, examples docs | fixed release note only |
| `tooling` | scripts, release workflows, root-drop/onefile build tooling | fixed frameworkVersion when public release surface |
| `example` | `examples/**`, samples, fixtures | usually none or patch |

## 2. Fixed Train 規則

固定同版代表 release 時同步 package versions，不代表每個 package 變更都強制升版。版本級別由最高 `release_impact` 決定。

範例：

- `docs` typo：不升版。
- `adapter` bugfix：patch。
- `core` compatible feature：minor。
- `schemas` breaking change：major。

## 3. Independent Candidate

可考慮 independent versioning 的候選：

- 單一 adapter 已被下游獨立 pin 住。
- agent-pack 有獨立 adapter release cadence。
- plugin 已形成獨立 public API 與 support window。

在 RFC 核准前，上述 package 仍留在 fixed train。

## 4. Release Manifest 表達方式

```yaml
frameworkVersion: 0.2.0
releaseTrain: fixed
packages:
  - name: "@ai-atomic-framework/core"
    package_group: core
    version: 0.2.0
  - name: "@ai-atomic-framework/adapter-local-git"
    package_group: adapter
    version: 0.2.0
impacts:
  - package_group: core
    release_impact: minor
    core_impact: minor
```

## 5. 不允許的做法

- 用 `0.1.99.xxx` 暗示 peripheral patch。
- 讓 package group 對應 SemVer 的某個數字欄位。
- 在未有 RFC 前讓 adapter 私自獨立版號。
- release note 只寫版本號，不寫 impact metadata。
