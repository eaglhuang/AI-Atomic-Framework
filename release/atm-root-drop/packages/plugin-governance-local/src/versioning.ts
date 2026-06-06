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
export function isValidSemverVersionString(version: string): boolean {
  if (!version) return false;
  // 標準 semver 格式：major.minor.patch，允許 pre-release 與 build metadata。
  const semverRegex = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;
  return semverRegex.test(version);
}

/**
 * additive coexistence resolver：抽出或補齊 dataVersion 與 artifactVersion。
 * 新欄位缺席時，安全退回 specVersion。
 */
export function resolveDataAndArtifactVersions(params: {
  specVersion?: string;
  dataVersion?: string;
  artifactVersion?: string;
}): {
  dataVersion: string;
  artifactVersion: string;
} {
  const fallback = params.specVersion || '0.1.0';
  return {
    dataVersion: params.dataVersion || fallback,
    artifactVersion: params.artifactVersion || fallback
  };
}

/** 確認 unknown 值是否為合法的 artifactVersionKind。 */
export function isArtifactVersionKind(value: unknown): value is ArtifactVersionKind {
  return value === 'semver' || value === 'git-sha' || value === 'sha256' || value === 'opaque';
}

/**
 * 比較 artifactVersion。
 *
 * - 只有相同 kind 可以比較；cross-kind 回傳 null。
 * - `semver` 依 semver 規則排序。
 * - `git-sha`、`sha256`、`opaque` 都是 identity-only：相同回傳 0，不同回傳 null。
 */
export function compareArtifactVersions(left: ArtifactVersionRef, right: ArtifactVersionRef): number | null {
  if (left.kind !== right.kind) {
    return null;
  }
  if (left.version === right.version) {
    return 0;
  }
  if (left.kind !== 'semver') {
    return null;
  }
  if (!isValidSemverVersionString(left.version) || !isValidSemverVersionString(right.version)) {
    return null;
  }
  return compareSemverVersions(left.version, right.version);
}

/**
 * 簡化版 semver comparator。
 * 回傳 1 表示 a > b，-1 表示 a < b，0 表示相同。
 */
export function compareSemverVersions(a: string, b: string): number {
  if (a === b) return 0;

  const parsePart = (v: string) => {
    const clean = v.split('-')[0].split('+')[0];
    return clean.split('.').map(Number);
  };

  const aParts = parsePart(a);
  const bParts = parsePart(b);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }

  return 0;
}
