# ATM 版本升級規則書

本規則書整合 ATM 版本升級主線、QA gates、release notes、tag、rollback 與開源 PR 政策。

## A. Discover

升級前先讀：

- `docs/ai_atomic_framework/upstream-versioning-policy.md`
- `docs/ai_atomic_framework/release_version_flow/OPEN_SOURCE_VERSIONING_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/PACKAGE_GROUPS.md`
- `.github/CODEOWNERS`
- `.atm/release-intents/*.md` 或 Changesets

Automation 應提供 classify command，讀取 ATM repository 的 touched files 並輸出 package group、public API、release surface 與 impact metadata。

## B. Classify

掃描 touched files 並分類：

- `core`
- `public`
- `non-public`
- `docs`
- `tooling`
- `peripheral`
- `release surface`

分類結果必須能映射到 `package_group` 與 `public_api`。

## C. Impact

要求或產生 release impact metadata：

```yaml
package_group: core
public_api: true
release_impact: patch
core_impact: patch
requires_migration: false
requires_release_note: true
```

若 PR 沒有 release intent，但 touched paths 命中 release-relevant scope，升級流程必須阻擋。

## D. Version Decide

以最高 `release_impact` 決定下一版：

- all `none`：不升版。
- max `patch`：`PATCH + 1`。
- max `minor`：`MINOR + 1`，`PATCH = 0`。
- max `major`：`MAJOR + 1`，`MINOR/PATCH = 0`。
- prerelease：用 `alpha.N`、`beta.N`、`rc.N` 或 `canary.<date>.<sha>`。

在 `0.x` 階段，`MINOR` 必須附 migration note。

## E. Validate Contributor Rules

外部 PR 需要檢查：

- Core PR 有 issue/RFC。
- Core PR 有 CODEOWNERS review。
- Core PR 有 migration 判斷。
- Public behavior 有 tests。
- Release surface 有 Release Owner review。
- 外部 contributor 未建立 official tag、release commit 或 dist-tag。

Automation 應提供 contributor-impact 與 CODEOWNERS validation command，並在 release-relevant PR 缺少 release intent 時阻擋或至少輸出 blocking warning。

## F. Freeze

Freeze 只鎖 release surface，不鎖 unrelated feature branches。

必 freeze：

- package version fields
- `compatibility-matrix.json`
- release notes
- root-drop / onefile artifacts
- release workflow
- dist-tag decision
- known-bad readiness

不應 freeze：

- 與 release 無關的 feature branches
- docs draft branch
- downstream adopter experiments

## G. Prepare Release

Release Owner 準備：

- 同步 package versions。
- 同步 compatibility matrix。
- 更新 lockfile。
- 產生 skew matrix。
- 產生 release notes。
- 產生 release manifest。
- 準備 rollback route。

## H. QA Gates

標準 gate：

```bash
node --experimental-strip-types scripts/validate-version-compatibility.ts --mode validate
node --experimental-strip-types scripts/validate-release-trust.ts --mode validate
node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate
npm run validate:standard
```

Release artifact gate：

- root-drop validation。
- onefile validation。
- adapter install smoke。
- fresh adopter smoke。
- known-bad readiness。

## I. Tag

正式 release tag 只能由 Release Owner 或授權 maintainer 建立。

- 使用 annotated tag。
- tag 必須符合 `v<frameworkVersion>`。
- tag version 必須與 root package、workspace packages、compatibility matrix 一致。
- prerelease tag 必須對應正確 npm dist-tag。

## J. Post-release

Release 後記錄：

- artifact paths。
- integrity manifest。
- SBOM。
- dist-tag。
- release notes。
- rollback route。
- known-bad update path。
- compatibility matrix diff PR。

## K. Rollback / Known-bad

若 release 出問題：

- 先標記 known-bad。
- 撤回或調整 dist-tag。
- 發布 patch rollback 或 forward fix。
- 保留 incident evidence。
- 更新 release trust docs。

Rollback 不得用非標準版號偽裝；仍走 SemVer patch 或 hotfix prerelease。
