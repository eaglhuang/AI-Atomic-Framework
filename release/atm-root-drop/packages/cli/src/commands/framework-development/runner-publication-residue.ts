import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluateRunnerPublicationDisposition,
  validateRunnerBuildOutputInventory,
  type RunnerBuildOutputInventory
} from '../../../../core/src/broker/runner-build-output-inventory.ts';

export interface RunnerPublicationReceiptReconciliation {
  readonly schemaId: 'atm.runnerPublicationReceiptReconciliation.v1';
  readonly taskId: string;
  readonly actorId: string;
  readonly legacyReceiptPath: string;
  readonly legacyTaskId: string;
  readonly expectedHeadDigest: string | null;
  readonly dirtyBeforeDigest: string;
  readonly restoredAfterDigest: string | null;
  readonly legacyInventoryDigest: string;
  readonly sealedSourceSha: string;
  readonly decision: 'restored-from-head' | 'already-restored' | 'deleted-untracked-orphan';
  readonly reconciledAt: string;
}

interface RunnerPublicationRecoveryLedger {
  readonly schemaId: 'atm.runnerPublicationRecoveryLedger.v1';
  readonly taskId: string;
  readonly records: readonly RunnerPublicationReceiptReconciliation[];
}

export function reconcileReceiptOnlyRunnerPublicationResidue(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly receiptRef: string;
  readonly activeStewardWorkIds: readonly string[];
  readonly now?: string;
}): RunnerPublicationReceiptReconciliation {
  const receiptRef = normalizeRunnerPublicationReceiptRef(input.receiptRef);
  const legacyTaskId = taskIdFromRunnerReceiptPath(receiptRef);
  if (!legacyTaskId) throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: reconciliation accepts only a repository-local runner-sync receipt path with attributable task identity.');
  const absoluteReceipt = path.join(input.cwd, receiptRef);
  if (!existsSync(absoluteReceipt)) throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt does not exist: ${receiptRef}.`);
  const currentRaw = readFileSync(absoluteReceipt, 'utf8');
  const currentDocument = parseRunnerReceipt(currentRaw, receiptRef);
  const currentInventory = currentDocument.inventory;
  if (String(currentDocument.document.taskId ?? '') !== legacyTaskId) throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt task attribution does not match ${receiptRef}.`);
  const stewardWorkId = typeof currentDocument.document.stewardWorkId === 'string' ? currentDocument.document.stewardWorkId.trim() : '';
  if (!stewardWorkId) throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is missing stewardWorkId.');
  if (input.activeStewardWorkIds.includes(stewardWorkId)) throw new Error(`ATM_RUNNER_SYNC_RESUME_REQUIRED: receipt ${receiptRef} belongs to active steward work ${stewardWorkId}; publish or release it instead of reconciling.`);

  const report = evaluateRunnerPublicationDisposition({ inventory: currentInventory, dirtyPaths: readRunnerPublicationDirtyPaths(input.cwd) });
  if (report.extraOutputPaths.length > 0 || report.dirtyInventoryPaths.length !== 1 || report.dirtyInventoryPaths[0] !== receiptRef) throw new Error(`ATM_RUNNER_PUBLICATION_PENDING: reconciliation requires ${receiptRef} to be the sole dirty inventory member and all generated outputs to be clean.`);

  const dirtyBeforeDigest = digestText(currentRaw);
  const committedRaw = tryReadGitFileAtHead(input.cwd, receiptRef);
  let expectedHeadDigest: string | null = null;
  let restoredAfterDigest: string | null = null;
  let decision: RunnerPublicationReceiptReconciliation['decision'];
  let reconciledInventory = currentInventory;
  if (committedRaw === null) {
    if (!isUntrackedPath(input.cwd, receiptRef)) throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: ${receiptRef} has no committed predecessor and is not an untracked orphan.`);
    rmSync(absoluteReceipt);
    decision = 'deleted-untracked-orphan';
  } else {
    const committedDocument = parseRunnerReceipt(committedRaw, receiptRef);
    if (String(committedDocument.document.taskId ?? '') !== legacyTaskId) throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: committed predecessor task attribution does not match ${receiptRef}.`);
    expectedHeadDigest = digestText(committedRaw);
    reconciledInventory = committedDocument.inventory;
    decision = currentRaw === committedRaw ? 'already-restored' : 'restored-from-head';
    if (decision === 'restored-from-head') writeFileSync(absoluteReceipt, committedRaw, 'utf8');
    restoredAfterDigest = digestText(readFileSync(absoluteReceipt, 'utf8'));
  }
  const reconciliation: RunnerPublicationReceiptReconciliation = {
    schemaId: 'atm.runnerPublicationReceiptReconciliation.v1', taskId: input.taskId, actorId: input.actorId,
    legacyReceiptPath: receiptRef, legacyTaskId, expectedHeadDigest, dirtyBeforeDigest, restoredAfterDigest,
    legacyInventoryDigest: reconciledInventory.digest, sealedSourceSha: reconciledInventory.sealedSourceSha, decision,
    reconciledAt: input.now ?? new Date().toISOString()
  };
  appendRunnerPublicationRecovery(input.cwd, reconciliation);
  return reconciliation;
}

export function readRunnerPublicationDirtyPaths(cwd: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) return [];
  return String(result.stdout ?? '').split(/\r?\n/).map((line) => line.length >= 4 ? line.slice(3).replace(/\\/g, '/').trim() : '').filter(Boolean);
}

export function readRunnerPublicationHeadSha(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
  return (result.status ?? 1) === 0 ? String(result.stdout ?? '').trim() : 'unknown';
}

export function readPublishedRunnerSealedSourceSha(cwd: string): string | null {
  const manifestPath = path.join(cwd, 'release', 'atm-onefile', 'release-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const sealedSourceCommit = typeof manifest.sealedSourceCommit === 'string' ? manifest.sealedSourceCommit.trim().toLowerCase() : '';
    return /^[a-f0-9]{40,64}$/.test(sealedSourceCommit) ? sealedSourceCommit : null;
  } catch { return null; }
}

export function readRunnerPublicationReceipts(cwd: string): Array<{ readonly path: string; readonly inventory: RunnerBuildOutputInventory; readonly terminalDisposition: 'published' | 'recovery-retained' | null }> {
  const evidenceRoot = path.join(cwd, '.atm', 'history', 'evidence');
  if (!existsSync(evidenceRoot)) return [];
  return readdirSync(evidenceRoot).filter((entry) => entry.endsWith('.runner-sync-receipt.json')).map((entry) => path.join(evidenceRoot, entry)).map((absolute) => {
    try {
      const document = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
      const validated = validateRunnerBuildOutputInventory(document.outputInventory);
      if (!validated.ok || !validated.inventory) return null;
      const disposition = document.publicationDisposition;
      return { path: path.relative(cwd, absolute).replace(/\\/g, '/'), inventory: validated.inventory, terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null, mtimeMs: statSync(absolute).mtimeMs };
    } catch { return null; }
  }).filter((entry): entry is { readonly path: string; readonly inventory: RunnerBuildOutputInventory; readonly terminalDisposition: 'published' | 'recovery-retained' | null; readonly mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs).map(({ mtimeMs: _mtimeMs, ...entry }) => entry);
}

export function normalizeRunnerPublicationReceiptRef(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt reference must be a repository-local path.');
  return normalized;
}

export function readRunnerPublicationReceiptAtPath(cwd: string, receiptRef: string): { readonly path: string; readonly inventory: RunnerBuildOutputInventory; readonly terminalDisposition: 'published' | 'recovery-retained' | null } | null {
  const absolute = path.resolve(cwd, receiptRef);
  if (!absolute.startsWith(path.resolve(cwd) + path.sep) || !existsSync(absolute)) return null;
  try {
    const document = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    const validated = validateRunnerBuildOutputInventory(document.outputInventory);
    if (!validated.ok || !validated.inventory) return null;
    const disposition = document.publicationDisposition;
    return { path: receiptRef, inventory: validated.inventory, terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null };
  } catch { return null; }
}

function taskIdFromRunnerReceiptPath(receiptRef: string): string | null {
  const match = /^\.atm\/history\/evidence\/([A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)+)\.runner-sync-receipt\.json$/i.exec(receiptRef);
  return match?.[1] ?? null;
}

function parseRunnerReceipt(raw: string, receiptRef: string): { document: Record<string, unknown>; inventory: RunnerBuildOutputInventory } {
  let document: Record<string, unknown>;
  try { document = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is not valid JSON: ${receiptRef}.`); }
  if (document.schemaId !== 'atm.runnerSyncReceipt.v1') throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt schema is invalid: ${receiptRef}.`);
  const validated = validateRunnerBuildOutputInventory(document.outputInventory);
  if (!validated.ok || !validated.inventory) throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt inventory is invalid: ${validated.reason ?? receiptRef}.`);
  return { document, inventory: validated.inventory };
}

function tryReadGitFileAtHead(cwd: string, receiptRef: string): string | null {
  const result = spawnSync('git', ['cat-file', 'blob', `HEAD:${receiptRef}`], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return (result.status ?? 1) === 0 ? String(result.stdout ?? '') : null;
}

function isUntrackedPath(cwd: string, receiptRef: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', receiptRef], { cwd, encoding: 'utf8' });
  return (result.status ?? 1) === 0 && String(result.stdout ?? '').split(/\r?\n/).some((line) => line.startsWith('?? ') && line.slice(3).replace(/\\/g, '/').trim() === receiptRef);
}

function appendRunnerPublicationRecovery(cwd: string, reconciliation: RunnerPublicationReceiptReconciliation): void {
  const recoveryPath = path.join(cwd, '.atm', 'history', 'evidence', `${reconciliation.taskId}.runner-publication-recovery.json`);
  mkdirSync(path.dirname(recoveryPath), { recursive: true });
  const records = readRecoveryRecords(recoveryPath, reconciliation.taskId);
  const duplicate = records.some((record) => record.legacyReceiptPath === reconciliation.legacyReceiptPath && record.dirtyBeforeDigest === reconciliation.dirtyBeforeDigest && record.decision === reconciliation.decision);
  const ledger: RunnerPublicationRecoveryLedger = { schemaId: 'atm.runnerPublicationRecoveryLedger.v1', taskId: reconciliation.taskId, records: duplicate ? records : [...records, reconciliation] };
  writeFileSync(recoveryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function readRecoveryRecords(recoveryPath: string, taskId: string): readonly RunnerPublicationReceiptReconciliation[] {
  if (!existsSync(recoveryPath)) return [];
  try {
    const existing = JSON.parse(readFileSync(recoveryPath, 'utf8')) as Record<string, unknown>;
    if (existing.schemaId === 'atm.runnerPublicationRecoveryLedger.v1' && existing.taskId === taskId && Array.isArray(existing.records)) return existing.records as RunnerPublicationReceiptReconciliation[];
    if (existing.schemaId === 'atm.runnerPublicationReceiptReconciliation.v1') return [existing as unknown as RunnerPublicationReceiptReconciliation];
  } catch { /* malformed recovery files are never destructive cleanup authority */ }
  throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: recovery ledger is invalid for ${taskId}.`);
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
