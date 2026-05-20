# Changeset Policy

ATM 的 release intent 可以由 Changesets 承載，也可以先用 `.atm/release-intents/*.md` 承載。無論使用哪種格式，都必須保留可機械化轉換的 release impact metadata。

## 1. 必填欄位

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

建議欄位：

```yaml
issue_or_rfc: "<url-or-id>"
affected_packages:
  - "@ai-atomic-framework/core"
validators:
  - "npm run validate:standard"
release_surface: true | false
```

## 2. 何時可用 `none`

可用 `release_impact: none`：

- docs typo。
- tests-only，不改 public fixtures。
- internal refactor，public API 與 behavior 不變。
- build script cleanup，不影響 release artifact。

不可用 `none`：

- CLI output 或 exit code 改變。
- schema 或 compatibility matrix 改變。
- adapter public behavior 改變。
- release workflow、dist-tag、known-bad、root-drop 改變。
- public docs 改變相容承諾或 migration promise。

## 3. Patch / Minor / Major

`patch`：

- backward-compatible bugfix。
- release tooling 修補。
- adapter public behavior bugfix。

`minor`：

- backward-compatible feature。
- 新 adapter capability。
- core compatible feature；`0.x` 階段需 migration note。

`major`：

- breaking public API。
- schema/CLI/release artifact 不相容變更。
- 需要 adopter 手動 migration 的 release。

## 4. Changelog 生成

Release note 必須由 release intent 聚合：

- Group by `package_group`。
- 標示 `release_impact` 與 `core_impact`。
- 列出 migration。
- 列出 release owner 與 code owner review。
- 列出 validator evidence。

## 5. Validation

CI 應檢查：

- 有 release-relevant path 時必須有 release intent。
- release intent 欄位合法。
- touched path 與 `package_group` 一致。
- 最高 impact 與 proposed next version 一致。
- core impact 需要 core review。
- release surface 需要 Release Owner review。
