# Open Source Versioning Policy

本政策規範 ATM 開源後的版本語意、package group、release train 與 release impact metadata。

## 1. 標準 SemVer

ATM 只使用標準 SemVer：

```text
MAJOR.MINOR.PATCH[-alpha.N|-beta.N|-rc.N|-canary.<date>.<sha>]
```

不得使用 `0.1.99.xxx`、`0.1.<group>.<patch>` 或任何把 package group 塞進版本號的格式。版本號只表達相容性等級：

- `MAJOR`：公開 API、schema、CLI、release surface 發生不相容變更。
- `MINOR`：相容功能新增；在 `0.x` 階段視為可能 breaking，必須有 migration note。
- `PATCH`：相容 bugfix、文件補正、release tooling 修補。
- prerelease：alpha、beta、rc、canary channel。

## 2. 單一 Framework Release Train

ATM 初期採 fixed release train。所有官方公開 packages 預設同步到同一個 `frameworkVersion`。

固定同版適用於：

- `packages/core`
- `packages/cli`
- `packages/plugin-sdk`
- `packages/adapter-*`
- `packages/integration-*`
- `packages/agent-pack-*`
- `packages/language-*`
- official root-drop 與 onefile release artifacts

固定同版不代表所有 package 都同等影響版本級別；影響級別由 release intent 決定。

## 3. Independent Versioning 升格條件

外圍 package 只有在 RFC 核准後才能獨立版號。RFC 必須證明：

- 該 package 已有獨立消費者。
- 該 package 有獨立 release cadence。
- 該 package 的相容範圍能獨立測試與描述。
- 拆分後不會讓 framework release manifest、support window 或 adopter onboarding 變得不可理解。

未通過 RFC 前，外圍 package 都留在 fixed train。

## 4. Release Impact Metadata

每個 release-relevant PR 必須提供：

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

`release_impact` 由最高 impact 決定下一版級別；`core_impact` 決定 core-specific gates。

## 5. Core 與 Peripheral 的差別

Core patch 與 peripheral patch 都是 `PATCH`。差別不寫在版本號，而寫在 release manifest：

```yaml
frameworkVersion: 0.1.4
impacts:
  - package_group: core
    release_impact: patch
    core_impact: patch
    summary: Fix registry version compatibility fallback.
  - package_group: adapter
    release_impact: patch
    core_impact: none
    summary: Fix local-git evidence path normalization.
```

## 6. Release Surface

下列路徑視為 release surface，任何變更都需要 Release Owner review：

- `release/**`
- `.github/workflows/release-*`
- `compatibility-matrix.json`
- `known-bad-versions.json`
- package version fields
- dist-tag policy
- root-drop / onefile release scripts
- migration guides and release notes

## 7. Policy Priority

若文件、release intent、compatibility matrix 或 package version 不一致，release 必須阻擋，直到一致性恢復。
