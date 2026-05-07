/**
 * ATM-2-0015: Hash Drift / Version Diff Report
 *
 * 比對 registry 中同一 atom 任兩個版本的 spec/code/test hash 差異，
 * 產出符合 hash-diff-report.schema.json 的報告。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

/**
 * 從 registry document 中找到指定 atomId 的 entry。
 * @param {object} registryDoc - 完整 registry JSON document
 * @param {string} atomId - 要查找的 Atomic ID
 * @returns {object|null} registry entry 或 null
 */
export function findRegistryEntry(registryDoc, atomId) {
  if (!registryDoc?.entries || !Array.isArray(registryDoc.entries)) {
    return null;
  }
  return registryDoc.entries.find(
    (entry) => entry.atomId === atomId || entry.id === atomId
  ) ?? null;
}

/**
 * 從 registry entry 的 versions[] 中取出指定版本的 hash 記錄。
 * @param {object} entry - registry entry（含 versions[]）
 * @param {string} version - 版本字串（如 "1.0.0"）
 * @returns {object|null} { version, specHash, codeHash, testHash, timestamp } 或 null
 */
export function findVersionRecord(entry, version) {
  if (!entry?.versions || !Array.isArray(entry.versions)) {
    return null;
  }
  return entry.versions.find((v) => v.version === version) ?? null;
}

/**
 * 計算兩個版本之間的 hash diff report。
 * @param {object} options
 * @param {object} options.entry - registry entry（含 versions[]）
 * @param {string} options.fromVersion - 基線版本
 * @param {string} options.toVersion - 目標版本
 * @param {string} [options.driftReason] - 漂移原因說明
 * @returns {object} 符合 hash-diff-report.schema.json 的報告
 */
export function computeHashDiffReport(options) {
  const { entry, fromVersion, toVersion, driftReason } = options;
  const atomId = entry.atomId ?? entry.id;

  const fromRecord = findVersionRecord(entry, fromVersion);
  const toRecord = findVersionRecord(entry, toVersion);

  if (!fromRecord) {
    throw new Error(`Version ${fromVersion} not found in versions[] for ${atomId}`);
  }
  if (!toRecord) {
    throw new Error(`Version ${toVersion} not found in versions[] for ${atomId}`);
  }

  // 計算三段 hash delta
  const specDelta = createHashDelta(fromRecord.specHash, toRecord.specHash);
  const codeDelta = createHashDelta(fromRecord.codeHash, toRecord.codeHash);
  const testDelta = createHashDelta(fromRecord.testHash, toRecord.testHash);

  // 計算 drift summary
  const changedFields = [];
  if (specDelta.changed) changedFields.push('specHash');
  if (codeDelta.changed) changedFields.push('codeHash');
  if (testDelta.changed) changedFields.push('testHash');

  // 計算 lineage continuity（所有中間版本是否存在）
  const lineageContinuity = checkLineageContinuity(entry, fromVersion, toVersion);

  // 計算 semantic fingerprint delta（如果有的話）
  const sfDelta = computeSemanticFingerprintDelta(fromRecord, toRecord);

  // 自動生成 driftReason（如果未提供）
  const resolvedDriftReason = driftReason ?? generateDefaultDriftReason(changedFields, fromVersion, toVersion);

  const report = {
    schemaId: 'atm.hashDiffReport',
    specVersion: '0.1.0',
    atomId,
    fromVersion,
    toVersion,
    generatedAt: new Date().toISOString(),
    deltas: {
      specHash: specDelta,
      codeHash: codeDelta,
      testHash: testDelta
    },
    driftSummary: {
      totalChanged: changedFields.length,
      changedFields,
      driftReason: resolvedDriftReason
    }
  };

  // 附加 optional 欄位
  if (sfDelta) {
    report.semanticFingerprintDelta = sfDelta;
  }

  report.lineageContinuity = lineageContinuity;

  return report;
}

/**
 * 建立單一 hash field 的 delta 物件。
 */
function createHashDelta(fromHash, toHash) {
  return {
    from: fromHash,
    to: toHash,
    changed: fromHash !== toHash
  };
}

/**
 * 檢查 fromVersion 到 toVersion 之間的 lineage 是否連續。
 * 所有中間版本都必須存在於 versions[] 中。
 */
function checkLineageContinuity(entry, fromVersion, toVersion) {
  if (!entry.versions || entry.versions.length < 2) {
    return true;
  }

  const sortedVersions = [...entry.versions]
    .map((v) => v.version)
    .sort(compareSemver);

  const fromIndex = sortedVersions.indexOf(fromVersion);
  const toIndex = sortedVersions.indexOf(toVersion);

  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }

  // 確認從 fromIndex 到 toIndex 之間沒有缺口
  // （在目前的實作中，只要兩個版本都在 versions[] 中即視為連續）
  return true;
}

/**
 * 計算 semantic fingerprint delta（如果版本記錄中有 sf 資訊）。
 */
function computeSemanticFingerprintDelta(fromRecord, toRecord) {
  const fromSf = fromRecord.semanticFingerprint ?? null;
  const toSf = toRecord.semanticFingerprint ?? null;

  if (fromSf === null && toSf === null) {
    return null;
  }

  return {
    from: fromSf,
    to: toSf,
    changed: fromSf !== toSf
  };
}

/**
 * 當 driftReason 未提供時，自動生成預設說明。
 */
function generateDefaultDriftReason(changedFields, fromVersion, toVersion) {
  if (changedFields.length === 0) {
    return `No hash changes detected between ${fromVersion} and ${toVersion}.`;
  }
  const fieldList = changedFields.join(', ');
  return `Hash drift detected in ${fieldList} between ${fromVersion} and ${toVersion}.`;
}

/**
 * 簡易 semver 比較函式。
 */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * 從檔案讀取 registry document。
 * @param {string} [registryPath] - 可選的 registry 檔路徑
 * @returns {object} parsed registry document
 */
export function loadRegistryDocument(registryPath) {
  const resolvedPath = registryPath
    ? path.resolve(registryPath)
    : path.join(repoRoot, 'atomic-registry.json');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Registry file not found: ${resolvedPath}`);
  }

  return JSON.parse(readFileSync(resolvedPath, 'utf8'));
}
