import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MICRO_EVIDENCE_RECEIPT_SCHEMA_ID = 'atm.microEvidenceReceipt.v1';
export const VALIDATION_RECEIPT_INDEX_SCHEMA_ID = 'atm.validationReceiptIndex.v1';

export type ValidationReceiptStatus = 'passed' | 'failed' | 'timeout';

export interface ValidationReceiptScopeFile {
  readonly path: string;
  readonly sha256: string | null;
  readonly mtimeMs: number | null;
  readonly size: number | null;
  readonly missing: boolean;
}

export interface ValidationReceiptScope {
  readonly strategy: 'conservative-files';
  readonly files: readonly ValidationReceiptScopeFile[];
}

export interface ValidationReceiptResultDetails extends Record<string, unknown> {
  readonly caseCount: number;
  readonly assertionCount: number;
  readonly quarantineStatus?: string | null;
  readonly advisory?: boolean | null;
  readonly failureReason?: string | null;
  readonly recoveryRoute?: string | null;
  readonly groupName?: string | null;
  readonly runnerIdentity?: string | null;
}

export interface MicroEvidenceReceipt {
  readonly schemaId: typeof MICRO_EVIDENCE_RECEIPT_SCHEMA_ID;
  readonly receiptId: string;
  readonly validatorName: string;
  readonly command: string;
  readonly status: ValidationReceiptStatus;
  readonly ok: boolean;
  readonly environment: {
    readonly platform: string;
    readonly nodeVersion: string;
  };
  readonly base: {
    readonly gitHead: string | null;
  };
  readonly payloadDigest: string;
  readonly scopeDigest: string;
  readonly reuseKey: string;
  readonly createdAt: string;
  readonly result: ValidationReceiptResultDetails;
  readonly scope: ValidationReceiptScope;
}

export interface ValidationReceiptWriteResult {
  readonly receipt: MicroEvidenceReceipt;
  readonly receiptPath: string;
  readonly indexPath: string;
  readonly attempts: number;
}

export interface ValidationReceiptReuseResult {
  readonly reusable: boolean;
  readonly receipt: MicroEvidenceReceipt | null;
  readonly reason: string | null;
  readonly receiptPath: string | null;
}

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const MAX_ATOMIC_WRITE_ATTEMPTS = 3;

export function validationReceiptStoreRoot(cwd: string): string {
  return path.join(cwd, '.atm', 'runtime', 'validation-receipts');
}

export function validationReceiptIndexPath(cwd: string, reuseKey: string): string {
  return path.join(validationReceiptStoreRoot(cwd), 'index', `${digestFileName(reuseKey)}.json`);
}

export function validationReceiptContentPath(cwd: string, receiptId: string): string {
  return path.join(validationReceiptStoreRoot(cwd), 'objects', `${digestFileName(receiptId)}.json`);
}

export function buildValidationReceiptInput(input: {
  cwd: string;
  validatorName: string;
  command: string;
  status: ValidationReceiptStatus;
  ok: boolean;
  gitHead: string | null;
  result: Record<string, unknown>;
  scopePaths: readonly string[];
  createdAt?: string;
  groupName?: string;
  runnerIdentity?: string;
}): MicroEvidenceReceipt {
  const normalizedCmd = normalizeCommand(input.command);
  const rawCaseCount = typeof input.result.caseCount === 'number' ? input.result.caseCount : 0;
  const rawAssertionCount = typeof input.result.assertionCount === 'number' ? input.result.assertionCount : 0;
  const rawQuarantine = typeof input.result.quarantineStatus === 'string' ? input.result.quarantineStatus : null;
  const rawAdvisory = typeof input.result.advisory === 'boolean' ? input.result.advisory : false;
  const groupName = input.groupName ?? (typeof input.result.groupName === 'string' ? input.result.groupName : null);
  const runnerIdentity = input.runnerIdentity ?? (typeof input.result.runnerIdentity === 'string' ? input.result.runnerIdentity : null);

  let failureReason: string | null = typeof input.result.failureReason === 'string' ? input.result.failureReason : null;
  let recoveryRoute: string | null = typeof input.result.recoveryRoute === 'string' ? input.result.recoveryRoute : null;

  let effectiveStatus = input.status;
  let effectiveOk = input.ok;

  // Hard gate: Zero-test / Zero-case or Zero-assertion success is rejected
  if (effectiveStatus === 'passed' && (rawCaseCount <= 0 || rawAssertionCount <= 0)) {
    effectiveStatus = 'failed';
    effectiveOk = false;
    if (!failureReason) {
      failureReason = rawCaseCount <= 0
        ? 'ATM_EVIDENCE_ZERO_CASE_SUCCESS_REJECTED: Validator reported zero cases passed'
        : 'ATM_EVIDENCE_ZERO_ASSERTION_SUCCESS_REJECTED: Validator reported zero assertions evaluated';
    }
    if (!recoveryRoute) {
      recoveryRoute = `Add executable test cases or assertions to ${input.validatorName} before recording evidence pass.`;
    }
  }

  // Hard gate: Advisory or Quarantined results cannot satisfy required acceptance as ok:true
  if (effectiveOk && (rawAdvisory || (rawQuarantine !== null && rawQuarantine !== 'active'))) {
    effectiveStatus = 'failed';
    effectiveOk = false;
    if (!failureReason) {
      failureReason = rawAdvisory
        ? 'ATM_EVIDENCE_ADVISORY_CANNOT_SATISFY_REQUIRED: Advisory validator cannot satisfy required acceptance'
        : `ATM_EVIDENCE_QUARANTINED_CANNOT_SATISFY_REQUIRED: Quarantined validator state (${rawQuarantine}) cannot satisfy required acceptance`;
    }
    if (!recoveryRoute) {
      recoveryRoute = rawAdvisory
        ? `Remove advisory flag or run required validator pass for ${input.validatorName}.`
        : `Unquarantine validator ${input.validatorName} before using as required acceptance evidence.`;
    }
  }

  const resultDetails: ValidationReceiptResultDetails = {
    ...input.result,
    caseCount: rawCaseCount,
    assertionCount: rawAssertionCount,
    quarantineStatus: rawQuarantine,
    advisory: rawAdvisory,
    failureReason,
    recoveryRoute,
    groupName,
    runnerIdentity
  };

  const scope = buildValidationReceiptScope(input.cwd, input.scopePaths);
  const payloadDigest = sha256Json({
    schemaId: 'atm.validationReceiptPayload.v1',
    validatorName: input.validatorName,
    command: normalizedCmd,
    status: effectiveStatus,
    ok: effectiveOk,
    result: resultDetails
  });
  const scopeDigest = sha256Json(scope);
  const reuseKey = sha256Json({
    schemaId: 'atm.validationReceiptReuseKey.v1',
    validatorName: input.validatorName,
    command: normalizedCmd,
    groupName: groupName ?? null,
    runnerIdentity: runnerIdentity ?? null,
    environment: {
      platform: process.platform,
      nodeVersion: process.version
    },
    base: {
      gitHead: input.gitHead
    },
    scopeDigest
  });
  const receiptId = sha256Json({
    schemaId: 'atm.validationReceiptId.v1',
    reuseKey,
    payloadDigest
  });

  return {
    schemaId: MICRO_EVIDENCE_RECEIPT_SCHEMA_ID,
    receiptId,
    validatorName: input.validatorName,
    command: normalizedCmd,
    status: effectiveStatus,
    ok: effectiveOk,
    environment: {
      platform: process.platform,
      nodeVersion: process.version
    },
    base: {
      gitHead: input.gitHead
    },
    payloadDigest,
    scopeDigest,
    reuseKey,
    createdAt: input.createdAt ?? new Date().toISOString(),
    result: resultDetails,
    scope
  };
}

export function writeValidationReceipt(cwd: string, receipt: MicroEvidenceReceipt): ValidationReceiptWriteResult {
  const receiptPath = validationReceiptContentPath(cwd, receipt.receiptId);
  const indexPath = validationReceiptIndexPath(cwd, receipt.reuseKey);
  const receiptWrite = writeJsonAtomic(receiptPath, receipt);
  const index = {
    schemaId: VALIDATION_RECEIPT_INDEX_SCHEMA_ID,
    reuseKey: receipt.reuseKey,
    receiptId: receipt.receiptId,
    receiptPath: normalizeRelativePath(cwd, receiptPath),
    updatedAt: new Date().toISOString()
  };
  const indexWrite = writeJsonAtomic(indexPath, index);
  return {
    receipt,
    receiptPath,
    indexPath,
    attempts: Math.max(receiptWrite.attempts, indexWrite.attempts)
  };
}

export function readReusableValidationReceipt(input: {
  cwd: string;
  validatorName: string;
  command: string;
  gitHead: string | null;
  scopePaths: readonly string[];
  groupName?: string | null;
  runnerIdentity?: string | null;
}): ValidationReceiptReuseResult {
  const scope = buildValidationReceiptScope(input.cwd, input.scopePaths);
  const scopeDigest = sha256Json(scope);
  const reuseKey = sha256Json({
    schemaId: 'atm.validationReceiptReuseKey.v1',
    validatorName: input.validatorName,
    command: normalizeCommand(input.command),
    groupName: input.groupName ?? null,
    runnerIdentity: input.runnerIdentity ?? null,
    environment: {
      platform: process.platform,
      nodeVersion: process.version
    },
    base: {
      gitHead: input.gitHead
    },
    scopeDigest
  });
  const indexPath = validationReceiptIndexPath(input.cwd, reuseKey);
  if (!existsSync(indexPath)) {
    return { reusable: false, receipt: null, reason: 'missing-index', receiptPath: null };
  }
  const index = readJson(indexPath);
  const receiptId = typeof index.receiptId === 'string' ? index.receiptId : '';
  if (!receiptId) {
    return { reusable: false, receipt: null, reason: 'invalid-index', receiptPath: null };
  }
  const receiptPath = validationReceiptContentPath(input.cwd, receiptId);
  if (!existsSync(receiptPath)) {
    return { reusable: false, receipt: null, reason: 'missing-receipt', receiptPath };
  }
  const receipt = readJson(receiptPath) as unknown as MicroEvidenceReceipt;
  if (receipt.schemaId !== MICRO_EVIDENCE_RECEIPT_SCHEMA_ID) {
    return { reusable: false, receipt: null, reason: 'schema-mismatch', receiptPath };
  }
  if (receipt.status !== 'passed' || receipt.ok !== true) {
    return { reusable: false, receipt, reason: 'not-passed', receiptPath };
  }
  if (receipt.validatorName !== input.validatorName || receipt.command !== normalizeCommand(input.command)) {
    return { reusable: false, receipt, reason: 'identity-mismatch', receiptPath };
  }
  if (receipt.reuseKey !== reuseKey || receipt.scopeDigest !== scopeDigest) {
    return { reusable: false, receipt, reason: 'scope-mismatch', receiptPath };
  }

  // Hard gates check during reuse as well
  const caseCount = typeof receipt.result.caseCount === 'number' ? receipt.result.caseCount : 0;
  const assertionCount = typeof receipt.result.assertionCount === 'number' ? receipt.result.assertionCount : 0;
  if (caseCount <= 0 || assertionCount <= 0) {
    return { reusable: false, receipt, reason: 'zero-test-disqualified', receiptPath };
  }

  if (receipt.result.advisory === true || (typeof receipt.result.quarantineStatus === 'string' && receipt.result.quarantineStatus !== 'active')) {
    return { reusable: false, receipt, reason: 'advisory-or-quarantined-disqualified', receiptPath };
  }

  return { reusable: true, receipt, reason: null, receiptPath };
}

export function garbageCollectValidationReceipts(input: {
  cwd: string;
  keepLatestPerKey?: number;
}): { removed: readonly string[] } {
  const keepLatestPerKey = Math.max(1, input.keepLatestPerKey ?? 1);
  const indexRoot = path.join(validationReceiptStoreRoot(input.cwd), 'index');
  const objectRoot = path.join(validationReceiptStoreRoot(input.cwd), 'objects');
  if (!existsSync(indexRoot) || !existsSync(objectRoot)) return { removed: [] };
  const keepIds = new Set<string>();
  for (const fileName of readdirSync(indexRoot).filter((entry) => entry.endsWith('.json'))) {
    const index = readJson(path.join(indexRoot, fileName));
    if (typeof index.receiptId === 'string') keepIds.add(index.receiptId);
  }
  const removed: string[] = [];
  for (const fileName of readdirSync(objectRoot).filter((entry) => entry.endsWith('.json'))) {
    const receiptId = path.basename(fileName, '.json');
    if (keepIds.has(receiptId) || keepLatestPerKey > 1) continue;
    const fullPath = path.join(objectRoot, fileName);
    rmSync(fullPath, { force: true });
    removed.push(normalizeRelativePath(input.cwd, fullPath));
  }
  return { removed };
}

function buildValidationReceiptScope(cwd: string, scopePaths: readonly string[]): ValidationReceiptScope {
  const files = [...new Set(scopePaths.map((entry) => normalizePath(entry)).filter(Boolean))]
    .flatMap((entry) => expandScopeEntry(cwd, entry))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readScopeFile(cwd, entry));
  return {
    strategy: 'conservative-files',
    files
  };
}

function expandScopeEntry(cwd: string, entry: string): string[] {
  const fullPath = path.join(cwd, entry);
  if (!existsSync(fullPath)) return [entry];
  const stat = statSync(fullPath);
  if (!stat.isDirectory()) return [entry];
  return readdirRecursive(fullPath)
    .map((filePath) => normalizeRelativePath(cwd, filePath))
    .filter((filePath) => !filePath.includes('/node_modules/'));
}

function readScopeFile(cwd: string, relativePath: string): ValidationReceiptScopeFile {
  const fullPath = path.join(cwd, relativePath);
  if (!existsSync(fullPath)) {
    return { path: normalizePath(relativePath), sha256: null, mtimeMs: null, size: null, missing: true };
  }
  const stat = statSync(fullPath);
  if (!stat.isFile()) {
    return { path: normalizePath(relativePath), sha256: null, mtimeMs: stat.mtimeMs, size: stat.size, missing: true };
  }
  return {
    path: normalizePath(relativePath),
    sha256: sha256Bytes(readFileSync(fullPath)),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    missing: false
  };
}

function writeJsonAtomic(filePath: string, value: unknown): { attempts: number } {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      renameSync(tempPath, filePath);
      return { attempts };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
      if (!RETRYABLE_RENAME_CODES.has(code) || attempts >= MAX_ATOMIC_WRITE_ATTEMPTS) {
        try { rmSync(tempPath, { force: true }); } catch {}
        throw error;
      }
      sleepMs(25 * attempts);
    }
  }
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
}

function readdirRecursive(dir: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...readdirRecursive(fullPath));
    } else if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeRelativePath(cwd: string, filePath: string): string {
  return normalizePath(path.relative(cwd, filePath));
}

function digestFileName(value: string): string {
  return value.replace(/^sha256:/, 'sha256-').replace(/[^a-z0-9-]/gi, '-');
}

function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
