import type { ArtifactVersionKind } from '@ai-atomic-framework/core';
/**
 * ATM versioning migration helper。
 *
 * 這個檔案只維護 dataVersion / artifactVersion 的純邏輯：
 * - 不做檔案系統操作
 * - 不執行 git
 * - 不依賴 stores.ts 或其他 stateful module
 * - 不做 runtime I/O
 */
export type { ArtifactVersionKind };
export interface ArtifactVersionRef {
    readonly version: string;
    readonly kind: ArtifactVersionKind;
}
/** 驗證版本字串是否符合 ATM 使用的 semver 格式，例如 "0.1.0"。 */
export declare function isValidSemverVersionString(version: string): boolean;
/**
 * additive coexistence resolver：抽出或補齊 dataVersion 與 artifactVersion。
 * 新欄位缺席時，安全退回 specVersion。
 */
export declare function resolveDataAndArtifactVersions(params: {
    specVersion?: string;
    dataVersion?: string;
    artifactVersion?: string;
}): {
    dataVersion: string;
    artifactVersion: string;
};
/** 確認 unknown 值是否為合法的 artifactVersionKind。 */
export declare function isArtifactVersionKind(value: unknown): value is ArtifactVersionKind;
/**
 * 比較 artifactVersion。
 *
 * - 只有相同 kind 可以比較；cross-kind 回傳 null。
 * - `semver` 依 semver 規則排序。
 * - `git-sha`、`sha256`、`opaque` 都是 identity-only：相同回傳 0，不同回傳 null。
 */
export declare function compareArtifactVersions(left: ArtifactVersionRef, right: ArtifactVersionRef): number | null;
/**
 * 簡化版 semver comparator。
 * 回傳 1 表示 a > b，-1 表示 a < b，0 表示相同。
 */
export declare function compareSemverVersions(a: string, b: string): number;
