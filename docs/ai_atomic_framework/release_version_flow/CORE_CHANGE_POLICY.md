# Core Change Policy

ATM core 對外部 contributor 開放，但 core PR 必須通過較高門檻，因為 core 變更會影響所有 adopter、adapter 與 release artifact。

## 1. Core Scope

以下視為 core scope：

- `packages/core/**`
- `schemas/**`
- `compatibility-matrix.json`
- `atomic-registry.json` 的公開相容欄位
- framework-level invariants
- registry lifecycle、evidence schema、scope lock、context summary contracts

## 2. Core PR 必備條件

Core PR 必須具備：

- issue 或 RFC 連結。
- release intent 或 changeset。
- CODEOWNERS core maintainer review。
- public API 判斷。
- migration note 或明確 `requires_migration: false`。
- integration tests 或 validator evidence。
- rollback route 或 state repair plan。

## 3. Breaking Change

Breaking change 包含：

- 移除或改名公開 schema 欄位。
- 改變 CLI public output、exit code 或 command behavior。
- 改變 compatibility matrix interpretation。
- 使既有 adopter repository 無法 read-only diagnostic。
- 改變 release artifact install/upgrade contract。

Breaking change 需要：

- RFC approval。
- `release_impact: major`。
- `core_impact: major`。
- migration guide。
- release note。
- rollback route。
- fresh adopter smoke。

在 `0.x` 階段，`MINOR` 也可能包含破壞性調整；但任何 adopter-visible break 仍必須有 migration note。

## 4. Core Bugfix

Core bugfix 使用 `PATCH`，但仍需要 core gates：

- regression test。
- compatibility matrix 不退化。
- root-drop / onefile smoke 不退化。
- 如果修補 state interpretation，需補 known-bad readiness 或 rollback note。

## 5. Non-public Core Refactor

若 core refactor 不改 public API，可標記：

```yaml
package_group: core
public_api: false
release_impact: none
core_impact: none
requires_migration: false
requires_release_note: false
```

但 maintainer 必須確認測試覆蓋 public behavior，且 release note 不需要說明。

## 6. Review Authority

外部 contributor 可以提交 core PR，但不得自行核准 release、建立 release commit、推 tag 或發布 package。Release Owner 只能在 core gates 全綠後執行正式 release。
