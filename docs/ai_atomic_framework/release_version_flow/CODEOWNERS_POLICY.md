# CODEOWNERS Policy

本文件定義 ATM 開源 PR 的 review ownership 與 branch protection 建議。

## 1. Owner 分層

| Scope | Required owner |
| --- | --- |
| `packages/core/**` | core maintainers |
| `schemas/**` | core maintainers |
| `compatibility-matrix.json` | core maintainers + release owners |
| `packages/cli/**`, `atm.mjs` | cli maintainers |
| `packages/integration-*`, `packages/adapter-*`, `packages/language-*` | adapter maintainers |
| `packages/agent-pack-*` | agent-pack maintainers |
| `release/**`, `.github/workflows/release-*`, `known-bad-versions.json` | release owners |
| docs policy surfaces | docs maintainers + relevant code owner |

## 2. Suggested CODEOWNERS

`.github/CODEOWNERS` 應至少包含：

```text
/packages/core/** @eaglhuang
/schemas/** @eaglhuang
/compatibility-matrix.json @eaglhuang

/packages/cli/** @eaglhuang
/atm.mjs @eaglhuang

/packages/integration-*/** @eaglhuang
/packages/adapter-*/** @eaglhuang
/packages/language-*/** @eaglhuang
/packages/agent-pack-*/** @eaglhuang

/release/** @eaglhuang
/.github/workflows/release-* @eaglhuang
/known-bad-versions.json @eaglhuang
```

專案有 GitHub team 後，可把 `@eaglhuang` 拆成 `@org/core-maintainers`、`@org/adapter-maintainers`、`@org/release-owners`。

## 3. Branch Protection

建議 main branch 啟用：

- Require pull request before merging。
- Require approvals from CODEOWNERS。
- Require status checks：standard validators、release trust、version compatibility、skew matrix。
- Restrict who can push official release tags。
- Require signed or annotated tags for releases。

## 4. Release Owner 權限

Release Owner 負責：

- 核准 release surface 變更。
- 執行正式 release workflow。
- 建立 annotated tag。
- 管理 dist-tag。
- 啟動 rollback 或 known-bad 標記。

外部 contributor 不可直接執行上述權限。

## 5. Review Escalation

任何 PR 若同時碰 core 與 release surface，必須同時取得 core maintainer 與 Release Owner review。若 release intent 宣稱 `none` 但 touched paths 命中 release surface，CI 應阻擋。
