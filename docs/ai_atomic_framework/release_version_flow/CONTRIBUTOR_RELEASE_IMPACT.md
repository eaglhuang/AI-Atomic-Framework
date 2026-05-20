# Contributor Release Impact Guide

本文件說明外部 contributor 如何填寫 release intent，以及 maintainer 如何判斷 `release_impact`。

## 1. 何時需要 Release Intent

需要 release intent 的情境：

- 修改 `packages/core/**`、`schemas/**` 或 `compatibility-matrix.json`。
- 修改 CLI 指令、輸出格式、exit code 或 public docs 承諾。
- 修改 adapter、plugin、agent-pack 的公開行為。
- 修改 release workflow、known-bad list、dist-tag、root-drop 或 onefile artifact。

可標記 `release_impact: none` 的情境：

- 純文件修字，不改承諾。
- 測試 fixture、內部 refactor，不改 public behavior。
- repo housekeeping，不影響 install、CLI、schema 或 adopter flow。

## 2. Release Intent 格式

ATM 初期可使用 `.atm/release-intents/<slug>.md`，格式如下：

```markdown
---
package_group: core
public_api: true
release_impact: minor
core_impact: minor
requires_migration: true
requires_release_note: true
issue_or_rfc: https://github.com/eaglhuang/AI-Atomic-Framework/issues/123
---

# Release Intent: Registry compatibility expansion

## Summary
Describe what changed and why adopters care.

## Public Surface
- schema field
- CLI output
- migration behavior

## Migration
Explain required migration or state "none".

## Tests
List validators, integration tests, and adopter smoke checks.
```

如果導入 Changesets，欄位必須能一對一轉換到 changelog 與版本判斷。

## 3. Impact 判斷表

| 變更類型 | release_impact | core_impact | 備註 |
| --- | --- | --- | --- |
| docs typo | none | none | 不進 release note。 |
| docs policy contract | patch | none | 若改 release contract，需 release note。 |
| adapter bugfix | patch | none | 公開行為修補。 |
| adapter new feature | minor | none | 相容新增。 |
| core non-public refactor | none | none | 需測試證明 public surface 不變。 |
| core bugfix | patch | patch | 需 core owner review。 |
| core compatible feature | minor | minor | `0.x` 階段附 migration note。 |
| core breaking change | major | major | 需 RFC、migration、rollback。 |
| release workflow change | patch | none | Release Owner review。 |

## 4. 外部 PR Checklist

- 填 release intent 或 changeset。
- 若碰 core，連結 issue/RFC。
- 標明 migration 是否需要。
- 列出測試與 validator。
- 不建立 release commit、不推 tag、不發布 npm。
- 等 CODEOWNERS 與 Release Owner review。

## 5. Maintainer Review Checklist

- release intent 欄位完整。
- package group 與 touched paths 一致。
- 最高 impact 可機械化推導下一版。
- core PR 已補 migration/test。
- release surface PR 已經 Release Owner review。
- release note 與 changelog 不遺漏 public behavior。
