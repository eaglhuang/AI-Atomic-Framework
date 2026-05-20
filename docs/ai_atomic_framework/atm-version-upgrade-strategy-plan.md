# ATM 版本升級策略規劃書

本文件定義 ATM 開源版本策略與版本升級流程的整體落地方案。核心原則是：版本號只表達相容性等級，影響範圍、風險與審核門檻交給 release intent、changeset 與 release manifest 表達。

## 1. 版本策略

ATM 採用標準 SemVer，不自訂 `0.1.99.xxx` 或將 `core/peripheral` 意義塞進數字欄位。

- `frameworkVersion` 永遠使用 `MAJOR.MINOR.PATCH[-alpha.N|-beta.N|-rc.N|-canary.<date>.<sha>]`。
- `MAJOR` 表示不相容公開 API 或 release surface 變更。
- `MINOR` 表示相容功能新增；在 `0.x` 階段，`MINOR` 仍視為可能 breaking，必須附 migration note。
- `PATCH` 表示相容 bugfix；core patch 與 peripheral patch 都是 patch，差別寫進 release manifest。
- build metadata 只能用於可追溯資訊，不可作為 release ordering 或 package group 語意。

## 2. Monorepo Release Train

ATM 初期採固定同版 release train。所有官方公開 packages 預設跟 `frameworkVersion` 同版，降低開源初期的安裝、教學與相容矩陣成本。

外圍 package 只有在同時符合下列條件時，才能透過 RFC 拆成 independent versioning：

- 有獨立消費者，不只是 framework release 的附屬產物。
- 有獨立 release cadence，且不需要每次跟 framework 同步。
- 有可獨立描述的相容範圍、migration path、support window。
- CI、docs、CODEOWNERS、release note 能獨立維護，不增加核心 release train 的不透明風險。

## 3. Release Impact Metadata

每個可能影響 release 的 PR 都必須提供可機械化讀取的 release intent。正式工具可採 Changesets；ATM 初期也可使用 `.atm/release-intents/*.md`。

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

最高 `release_impact` 決定版本級別；`core_impact` 決定 core review、migration 與 integration gate，而不是改寫版本號格式。

## 4. 開源貢獻策略

ATM core 對外部 contributor 開放，但審核門檻高於 docs、examples 或 adapter 變更。

- Core PR 必須有 issue 或 RFC 連結、release intent、CODEOWNERS review、migration 判斷與 integration tests。
- 外部 contributor 不可觸發正式 release、建立 release commit、推 official tag 或發布 npm dist-tag。
- 非 core PR 若只改 docs、tests、internal refactor，可標記 `release_impact: none`。
- Adapter、plugin、agent-pack 的公開行為改動至少需要 patch 或 minor release intent。
- 任何碰到 release surface 的變更，即使不在 core，也需要 Release Owner review。

## 5. 文件落地

中文策略與操作規則集中在：

- `docs/ai_atomic_framework/release_version_flow/OPEN_SOURCE_VERSIONING_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/CONTRIBUTOR_RELEASE_IMPACT.md`
- `docs/ai_atomic_framework/release_version_flow/CORE_CHANGE_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/PACKAGE_GROUPS.md`
- `docs/ai_atomic_framework/release_version_flow/CODEOWNERS_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/CHANGESET_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/ATM_VERSION_UPGRADE_RULES.md`

英文 upstream-facing 文件集中在：

- `docs/ai_atomic_framework/release-version-upgrade-rules.md`
- `docs/ai_atomic_framework/open-source-versioning-policy.md`
- `docs/ai_atomic_framework/contributor-release-impact.md`

既有 `docs/ai_atomic_framework/upstream-versioning-policy.md` 保持為 release-train policy surface，並連回上述新文件。

## 6. 自動化路線

後續版本升級 skill 應引用外部 release-impact automation surface。該 automation 至少要提供：

- classify：掃描 touched files 並輸出 package group、public API 與 release surface。
- impact：用最高 impact 推導 patch/minor/major/prerelease。
- validate-contributor-impact：檢查 release intent、core PR 與 migration gate。
- validate-codeowners：檢查 CODEOWNERS owner scope。
- validate-release：檢查 release docs、release surface 與 release manifest readiness。

這些命令只負責分類、檢查與產生 release evidence；正式 release、tag、npm publish 仍由 Release Owner 或授權 maintainer 執行。

## 7. 驗收計畫

- 文件驗證：搜尋 `0.1.99`、`independent`、`fixed`、`CODEOWNERS`、`release_impact`、`core_impact`，確認策略一致。
- 編碼驗證：對 touched Markdown 與 skill 檔跑 encoding touched guard。
- 上游 release gate：跑 version compatibility、release trust、skew matrix 與 standard validators。
- Automation fixture：以 core-change、docs-only、adapter-patch 三個 fixture 驗證分類結果。

## 8. Assumptions

- ATM 初期固定同版比獨立版號更適合開源初期溝通。
- 外圍 package 暫不獨立版號；獨立 cadence 出現後再以 RFC 拆分。
- Core PR 開放，但必須通過 CODEOWNERS、Release Owner、CI 與 migration gate。
- 版本號只承載相容性；package group、風險、core/peripheral 影響全部交給 metadata。
