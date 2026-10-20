import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, relativePathFrom } from '../shared.ts';
import { readCloseWindowStagedIndexLockReport, releaseCloseWindowStagedIndexLock } from '../tasks/close-window-lock.ts';
import { closeRecoveryCommand, inspectCloseHolderLiveness, resolveCloseRecoveryStaleAfterMs, type CloseHolderLiveness } from '../tasks/close-holder-liveness.ts';
import { readCloseTransactionStatus, writeCloseTransactionStatus, type CloseTransactionStatus } from './close-transaction-status.ts';
import type { CloseWriteRollbackSnapshot } from './close-orchestration.ts';

/**
 * Governed recovery lane for an interrupted `taskflow close --write` (#373).
 *
 * A close that dies after the ledger write leaves a non-terminal close
 * transaction and an active close-window staged-index lock that only the dead
 * holder could release. This lane reconciles that state against what actually
 * landed, and either rolls the close forward or aborts it:
 *
 * - `--recover`: if the close already landed on HEAD, mark the transaction
 *   completed and release the lock as committed. If it did not land and the
 *   staged close state is consistent (index ledger closed, working ledger equal
 *   to it, close transition present), finish the governed commit first.
 * - `--abort`: unstage the close's artifacts, archive the files the close
 *   created, restore the ledger and planning card to their pre-close content,
 *   mark the transaction rolled back and release the lock as aborted. Refused
 *   once the close landed, so a close can never be applied twice.
 *
 * Both are dry-run unless `--write`, refuse while the holder is alive, append
 * an auditable entry to `.atm/history/evidence/<task>.close-recovery.json`, and
 * are no-ops when nothing is left to recover.
 */

export const CLOSE_RECOVERY_SNAPSHOT_SCHEMA_ID = 'atm.closeRecoverySnapshot.v1';
export const CLOSE_RECOVERY_RECEIPT_SCHEMA_ID = 'atm.closeRecoveryReceipt.v1';
const CLOSED_STATUSES = new Set(['done', 'review', 'blocked', 'abandoned']);
const CLOSE_ACTIONS = new Set(['close', 'block', 'abandon']);
const LEDGER_CLOSE_FIELDS = ['closedAt', 'closedByActor', 'closedBySessionId', 'closurePacket', 'completedAt', 'completedByAgent', 'deliveryCommit', 'abandonResidueDisposition'];
const CARD_CLOSE_KEYS = ['completed_at', 'completed_by_agent', 'closedAt', 'closedByActor', 'closedByCommand', 'lastTransitionId', 'lastTransitionAt', 'ledgerContractVersion', 'delivery_commit'];

export interface CloseRecoverySnapshot extends CloseWriteRollbackSnapshot {
  readonly schemaId: typeof CLOSE_RECOVERY_SNAPSHOT_SCHEMA_ID;
  readonly taskId: string;
  readonly actorId: string;
  readonly createdAt: string;
  readonly ownerPid: number;
}

function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function sha256Text(text: string): string { return `sha256:${createHash('sha256').update(text).digest('hex')}`; }

export function closeRecoverySnapshotPath(cwd: string, taskId: string): string {
  return path.join(cwd, '.atm', 'runtime', 'close-transactions', `${taskId}.rollback-snapshot.json`);
}

/** Persist the in-memory rollback snapshot so a later process can abort a close whose holder died. */
export function persistCloseRecoverySnapshot(input: { cwd: string; taskId: string; actorId: string; snapshot: CloseWriteRollbackSnapshot }): void {
  const filePath = closeRecoverySnapshotPath(input.cwd, input.taskId);
  const previous = readCloseRecoverySnapshot(input.cwd, input.taskId);
  const record: CloseRecoverySnapshot = {
    ...input.snapshot,
    schemaId: CLOSE_RECOVERY_SNAPSHOT_SCHEMA_ID,
    taskId: input.taskId,
    actorId: input.actorId,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    ownerPid: process.pid
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function clearCloseRecoverySnapshot(cwd: string, taskId: string): void {
  rmSync(closeRecoverySnapshotPath(cwd, taskId), { force: true });
}

/**
 * Record how a `taskflow close --write` ended so the transaction receipt
 * reaches a terminal phase instead of staying at ledger-written. The persisted
 * snapshot is dropped once the close either landed or was rolled back in
 * process; a failed close keeps it so `--abort` can restore the pre-close state.
 */
export function recordCloseWriteOutcome(input: { cwd: string; taskId: string; outcome: 'completed' | 'rolled-back' | 'failed'; failure?: string | null }): void {
  if (!readCloseTransactionStatus(input.cwd, input.taskId) && input.outcome !== 'completed') return;
  if (input.outcome === 'completed') {
    const head = (git(input.cwd, ['rev-parse', 'HEAD']) ?? '').trim() || null;
    writeCloseTransactionStatus({ cwd: input.cwd, taskId: input.taskId, phase: 'post-cleanup-complete', outcome: 'completed', targetCommit: head, cleanupComplete: true, failure: null });
  } else if (input.outcome === 'rolled-back') {
    writeCloseTransactionStatus({ cwd: input.cwd, taskId: input.taskId, phase: 'rolled-back', outcome: 'rolled-back', failure: input.failure ?? null });
  } else {
    writeCloseTransactionStatus({ cwd: input.cwd, taskId: input.taskId, phase: 'failed', outcome: 'failed', failure: input.failure ?? null });
  }
  if (input.outcome !== 'failed') clearCloseRecoverySnapshot(input.cwd, input.taskId);
}

export function readCloseRecoverySnapshot(cwd: string, taskId: string): CloseRecoverySnapshot | null {
  const filePath = closeRecoverySnapshotPath(cwd, taskId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as CloseRecoverySnapshot;
    return parsed.schemaId === CLOSE_RECOVERY_SNAPSHOT_SCHEMA_ID && parsed.taskId === taskId ? parsed : null;
  } catch {
    return null;
  }
}

interface LedgerView { readonly status: string | null; readonly lastTransitionId: string | null; readonly text: string; readonly document: Record<string, unknown> }

function parseLedger(text: string | null): LedgerView | null {
  if (text === null) return null;
  try {
    const document = JSON.parse(text) as Record<string, unknown>;
    return { status: typeof document.status === 'string' ? document.status : null, lastTransitionId: typeof document.lastTransitionId === 'string' ? document.lastTransitionId : null, text, document };
  } catch {
    return null;
  }
}

function ledgerRelativePath(taskId: string): string { return `.atm/history/tasks/${taskId}.json`; }

function readTransitionEvent(cwd: string, taskId: string, transitionId: string | null): Record<string, unknown> | null {
  if (!transitionId) return null;
  const filePath = path.join(cwd, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`);
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function listTaskEvents(cwd: string, taskId: string): Array<{ relativePath: string; transitionId: string; event: Record<string, unknown> | null }> {
  const directory = path.join(cwd, '.atm', 'history', 'task-events', taskId);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const transitionId = name.replace(/\.json$/, '');
    return { relativePath: `.atm/history/task-events/${taskId}/${name}`, transitionId, event: readTransitionEvent(cwd, taskId, transitionId) };
  });
}

function eventTime(entry: { event: Record<string, unknown> | null }): number {
  return Date.parse(String(entry.event?.createdAt ?? ''));
}

function isTrackedAtHead(cwd: string, relativePath: string): boolean {
  return git(cwd, ['cat-file', '-e', `HEAD:${relativePath}`]) !== null;
}

function stagedFiles(cwd: string): string[] {
  return (git(cwd, ['diff', '--cached', '--name-only']) ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function isTaskOwnedPath(taskId: string, filePath: string, cardPath: string | null): boolean {
  return filePath === ledgerRelativePath(taskId)
    || filePath.startsWith(`.atm/history/task-events/${taskId}/`)
    || filePath.startsWith(`.atm/history/evidence/${taskId}.`)
    || (cardPath !== null && filePath === cardPath);
}

function resolveCardPath(cwd: string, ledger: LedgerView | null, snapshot: CloseRecoverySnapshot | null): string | null {
  if (snapshot?.planningCard?.absolutePath) return relativePathFrom(cwd, snapshot.planningCard.absolutePath);
  const source = ledger?.document.source as Record<string, unknown> | undefined;
  const planPath = typeof source?.planPath === 'string' ? source.planPath : null;
  if (!planPath) return null;
  const absolute = path.isAbsolute(planPath) ? planPath : path.resolve(cwd, planPath);
  return existsSync(absolute) ? relativePathFrom(cwd, absolute) : null;
}

function sealedCardDigest(ledger: LedgerView | null): string | null {
  const source = ledger?.document.source as Record<string, unknown> | undefined;
  const seal = source?.planningSourceSeal as Record<string, unknown> | undefined;
  return typeof seal?.contentDigest === 'string' ? seal.contentDigest : null;
}

export interface CloseRecoveryInspection {
  readonly schemaId: 'atm.closeRecoveryInspection.v1';
  readonly taskId: string;
  readonly transaction: CloseTransactionStatus | null;
  readonly transactionTerminal: boolean;
  readonly lock: { readonly present: boolean; readonly status: string | null; readonly holderTaskId: string | null; readonly acquiredAt: string | null; readonly heldByTask: boolean };
  readonly holder: CloseHolderLiveness;
  readonly ledger: { readonly head: { status: string | null; lastTransitionId: string | null } | null; readonly index: { status: string | null; lastTransitionId: string | null } | null; readonly working: { status: string | null; lastTransitionId: string | null } | null; readonly workingEqualsIndex: boolean };
  readonly landed: boolean;
  readonly landedCommit: string | null;
  readonly snapshotPresent: boolean;
  readonly sealReceipt: { readonly path: string; readonly sealDigest: string | null; readonly targetHeadBeforeCommit: string | null } | null;
  readonly closeTransition: { readonly transitionId: string; readonly action: string | null; readonly fromStatus: string | null; readonly toStatus: string | null } | null;
  readonly state: 'nothing-to-recover' | 'interrupted-landed' | 'interrupted-not-landed' | 'holder-alive';
  readonly rollForward: { readonly possible: boolean; readonly reasons: readonly string[] };
  readonly abort: { readonly possible: boolean; readonly reasons: readonly string[] };
  readonly recommendedCommand: string | null;
}

export function inspectCloseRecovery(input: { cwd: string; taskId: string; staleAfterMs?: number; nowMs?: number; isAlive?: (pid: number) => boolean }): CloseRecoveryInspection {
  const { cwd, taskId } = input;
  const transaction = readCloseTransactionStatus(cwd, taskId);
  const transactionTerminal = transaction === null || transaction.outcome === 'completed' || transaction.outcome === 'rolled-back' || transaction.phase === 'post-cleanup-complete' || transaction.phase === 'rolled-back';
  const lockRecord = readCloseWindowStagedIndexLockReport(cwd);
  const heldByTask = lockRecord?.status === 'active' && lockRecord.taskId === taskId;
  const lock = { present: lockRecord !== null, status: lockRecord?.status ?? null, holderTaskId: lockRecord?.taskId ?? null, acquiredAt: lockRecord?.acquiredAt ?? null, heldByTask };
  const holder = inspectCloseHolderLiveness({ cwd, taskId, lockAcquiredAt: heldByTask ? lockRecord?.acquiredAt : transaction?.updatedAt ?? null, staleAfterMs: input.staleAfterMs, nowMs: input.nowMs, isAlive: input.isAlive });
  const ledgerPath = ledgerRelativePath(taskId);
  const head = parseLedger(git(cwd, ['show', `HEAD:${ledgerPath}`]));
  const index = parseLedger(git(cwd, ['show', `:${ledgerPath}`]));
  const workingAbsolute = path.join(cwd, ledgerPath);
  const working = parseLedger(existsSync(workingAbsolute) ? readFileSync(workingAbsolute, 'utf8') : null);
  const startedMs = Date.parse(transaction?.startedAt ?? '');
  const headEvent = readTransitionEvent(cwd, taskId, head?.lastTransitionId ?? null);
  const headEventMs = Date.parse(String(headEvent?.createdAt ?? ''));
  const landed = head !== null && CLOSED_STATUSES.has(head.status ?? '')
    && (headEvent === null || CLOSE_ACTIONS.has(String(headEvent.action ?? '')))
    && (!Number.isFinite(startedMs) || !Number.isFinite(headEventMs) || headEventMs >= startedMs - 1000);
  const landedCommit = landed ? (git(cwd, ['log', '-1', '--format=%H', '--', ledgerPath]) ?? '').trim() || null : null;
  const sealPath = `.atm/history/evidence/${taskId}.seal-and-commit.json`;
  let sealReceipt: CloseRecoveryInspection['sealReceipt'] = null;
  if (existsSync(path.join(cwd, sealPath))) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(cwd, sealPath), 'utf8')) as Record<string, unknown>;
      sealReceipt = { path: sealPath, sealDigest: typeof parsed.sealDigest === 'string' ? parsed.sealDigest : null, targetHeadBeforeCommit: typeof parsed.targetHeadBeforeCommit === 'string' ? parsed.targetHeadBeforeCommit : null };
    } catch { sealReceipt = { path: sealPath, sealDigest: null, targetHeadBeforeCommit: null }; }
  }
  const closeLedger = index && CLOSED_STATUSES.has(index.status ?? '') ? index : working && CLOSED_STATUSES.has(working.status ?? '') ? working : null;
  const closeEvent = closeLedger ? readTransitionEvent(cwd, taskId, closeLedger.lastTransitionId) : null;
  const latestCloseEvent = closeEvent ? null : listTaskEvents(cwd, taskId).filter((entry) => CLOSE_ACTIONS.has(String(entry.event?.action ?? '')) && entry.event?.taskPath === ledgerPath && (!Number.isFinite(startedMs) || eventTime(entry) >= startedMs - 1000)).pop() ?? null;
  const transitionSource = closeEvent ?? latestCloseEvent?.event ?? null;
  const closeTransition = transitionSource ? { transitionId: String(transitionSource.transitionId ?? ''), action: typeof transitionSource.action === 'string' ? transitionSource.action : null, fromStatus: typeof transitionSource.fromStatus === 'string' ? transitionSource.fromStatus : null, toStatus: typeof transitionSource.toStatus === 'string' ? transitionSource.toStatus : null } : null;
  const workingEqualsIndex = index !== null && working !== null && index.text === working.text;
  const stuck = heldByTask || !transactionTerminal;
  const snapshot = readCloseRecoverySnapshot(cwd, taskId);
  const rollReasons: string[] = [];
  if (!index || !CLOSED_STATUSES.has(index.status ?? '')) rollReasons.push('the staged ledger is not in a closed status');
  if (!workingEqualsIndex) rollReasons.push('the working ledger differs from the staged close ledger (changed after the close was interrupted)');
  if (!closeEvent || !CLOSE_ACTIONS.has(String(closeEvent.action ?? '')) || closeEvent.toStatus !== index?.status) rollReasons.push('the staged ledger does not end in its close transition event');
  const abortReasons: string[] = [];
  if (landed) abortReasons.push('the close already landed on HEAD; aborting would undo a committed close');
  if (!snapshot && working && CLOSED_STATUSES.has(working.status ?? '') && !closeTransition?.fromStatus) abortReasons.push('no pre-close snapshot and no close transition records the previous status');
  let state: CloseRecoveryInspection['state'];
  if (holder.alive && stuck) state = 'holder-alive';
  else if (landed && stuck) state = 'interrupted-landed';
  else if (!landed && stuck) state = 'interrupted-not-landed';
  else state = 'nothing-to-recover';
  const rollForwardPossible = state === 'interrupted-landed' || (state === 'interrupted-not-landed' && rollReasons.length === 0);
  const abortPossible = state === 'interrupted-not-landed' && abortReasons.length === 0;
  const recommendedCommand = state === 'interrupted-landed' || (state === 'interrupted-not-landed' && rollForwardPossible)
    ? closeRecoveryCommand(taskId, 'recover')
    : state === 'interrupted-not-landed' && abortPossible ? closeRecoveryCommand(taskId, 'abort') : null;
  return {
    schemaId: 'atm.closeRecoveryInspection.v1', taskId, transaction, transactionTerminal, lock, holder,
    ledger: {
      head: head ? { status: head.status, lastTransitionId: head.lastTransitionId } : null,
      index: index ? { status: index.status, lastTransitionId: index.lastTransitionId } : null,
      working: working ? { status: working.status, lastTransitionId: working.lastTransitionId } : null,
      workingEqualsIndex
    },
    landed, landedCommit, snapshotPresent: snapshot !== null, sealReceipt, closeTransition, state,
    rollForward: { possible: rollForwardPossible, reasons: state === 'interrupted-not-landed' ? rollReasons : [] },
    abort: { possible: abortPossible, reasons: state === 'interrupted-not-landed' || landed ? abortReasons : [] },
    recommendedCommand
  };
}

interface ArchivedArtifact { readonly path: string; readonly archivePath: string; readonly sha256: string }

function archiveFile(cwd: string, relativePath: string, archiveRoot: string, archived: ArchivedArtifact[]): void {
  const absolute = path.join(cwd, relativePath);
  if (!existsSync(absolute)) return;
  const text = readFileSync(absolute, 'utf8');
  const target = path.join(archiveRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(absolute, target);
  archived.push({ path: relativePath, archivePath: relativePathFrom(cwd, target), sha256: sha256Text(text) });
}

function stripCardCloseMetadata(text: string, fromStatus: string | null): string | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/).filter((line) => !CARD_CLOSE_KEYS.some((key) => line.startsWith(`${key}:`)));
  const restored = lines.map((line) => (fromStatus && /^status:\s*/.test(line) ? `status: ${fromStatus}` : line));
  return `---\n${restored.join('\n')}\n---${match[2]}${text.slice(match[0].length)}`;
}

function appendRecoveryReceipt(cwd: string, taskId: string, entry: Record<string, unknown>): string {
  const relative = `.atm/history/evidence/${taskId}.close-recovery.json`;
  const absolute = path.join(cwd, relative);
  let receipt: { schemaId: string; taskId: string; entries: unknown[] } = { schemaId: CLOSE_RECOVERY_RECEIPT_SCHEMA_ID, taskId, entries: [] };
  if (existsSync(absolute)) {
    try {
      const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
      if (parsed?.schemaId === CLOSE_RECOVERY_RECEIPT_SCHEMA_ID && Array.isArray(parsed.entries)) receipt = parsed;
    } catch { /* an unreadable receipt is replaced by a fresh one; the archive keeps the evidence */ }
  }
  receipt.entries.push(entry);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return relative;
}

function releaseDeadHolderMutex(holder: CloseHolderLiveness): boolean {
  if (holder.alive || !existsSync(holder.mutexPath)) return false;
  rmSync(holder.mutexPath, { force: true });
  return true;
}

function inspectionSummary(inspection: CloseRecoveryInspection) {
  return { state: inspection.state, phase: inspection.transaction?.phase ?? null, outcome: inspection.transaction?.outcome ?? null, lock: inspection.lock, holder: { alive: inspection.holder.alive, reason: inspection.holder.reason, ownerPid: inspection.holder.ownerPid, leaseExpiresAt: inspection.holder.leaseExpiresAt }, ledger: inspection.ledger, landed: inspection.landed, landedCommit: inspection.landedCommit };
}

function finalizeLanded(input: { cwd: string; taskId: string; actorId: string; reason: string; inspection: CloseRecoveryInspection; commitSha: string | null; mode: 'recover' }) {
  const { cwd, taskId, inspection } = input;
  const targetCommit = input.commitSha ?? inspection.landedCommit;
  writeCloseTransactionStatus({ cwd, taskId, phase: 'post-cleanup-complete', outcome: 'completed', targetCommit, cleanupComplete: true, failure: null });
  const released = releaseCloseWindowStagedIndexLock({ cwd, taskId, actorId: input.actorId, outcome: 'committed' });
  const mutexRemoved = releaseDeadHolderMutex(inspection.holder);
  const snapshot = readCloseRecoverySnapshot(cwd, taskId);
  clearCloseRecoverySnapshot(cwd, taskId);
  const receiptPath = appendRecoveryReceipt(cwd, taskId, {
    recoveryId: `close-recovery-${Date.now()}-${randomBytes(3).toString('hex')}`, action: input.commitSha ? 'roll-forward-commit' : 'roll-forward-landed',
    actorId: input.actorId, reason: input.reason, at: new Date().toISOString(), before: inspectionSummary(inspection),
    targetCommit, lockReleased: released ? released.releaseOutcome : null, deadMutexRemoved: mutexRemoved, snapshotCleared: snapshot !== null
  });
  return { targetCommit, lockReleased: released !== null, mutexRemoved, receiptPath };
}

async function commitStagedClose(input: { cwd: string; taskId: string; actorId: string; reason: string; inspection: CloseRecoveryInspection }): Promise<string> {
  const { runAtmGit } = await import('../git-governance.ts');
  const trailers: string[] = [];
  const seal = input.inspection.sealReceipt;
  if (seal?.sealDigest) trailers.push(`ATM-Seal-Digest: ${seal.sealDigest}`, `ATM-Seal-Manifest: ${seal.path}`);
  if (seal?.targetHeadBeforeCommit) trailers.push(`ATM-Target-Head-Before: ${seal.targetHeadBeforeCommit}`);
  trailers.push(`ATM-Close-Recovery: rolled forward interrupted taskflow close after ${input.inspection.transaction?.phase ?? 'unknown phase'}`);
  const argv = ['commit', '--cwd', input.cwd, '--actor', input.actorId, '--task', input.taskId, '--auto-stage',
    '--message', `chore(taskflow): close ${input.taskId} target governance bundle`, ...trailers.flatMap((line) => ['--trailer', line])];
  const result = await runAtmGit(argv) as { ok?: boolean; evidence?: { commitSha?: unknown }; messages?: unknown } | null;
  const commitSha = typeof result?.evidence?.commitSha === 'string' ? result.evidence.commitSha : null;
  if (!result?.ok || !commitSha) {
    throw new CliError('ATM_CLOSE_RECOVERY_COMMIT_FAILED', `Governed commit of the interrupted close bundle for ${input.taskId} failed; nothing was released.`, { exitCode: 1, details: { gitResult: result?.messages ?? result } });
  }
  return commitSha;
}

function abortInterruptedClose(input: { cwd: string; taskId: string; actorId: string; reason: string; inspection: CloseRecoveryInspection }) {
  const { cwd, taskId, inspection } = input;
  const recoveryId = `close-recovery-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const archiveRoot = path.join(cwd, '.atm', 'runtime', 'close-recovery', taskId, recoveryId);
  const snapshot = readCloseRecoverySnapshot(cwd, taskId);
  const ledgerPath = ledgerRelativePath(taskId);
  const workingAbsolute = path.join(cwd, ledgerPath);
  const working = parseLedger(existsSync(workingAbsolute) ? readFileSync(workingAbsolute, 'utf8') : null);
  const index = parseLedger(git(cwd, ['show', `:${ledgerPath}`]));
  const cardPath = resolveCardPath(cwd, working ?? index, snapshot);
  const startedMs = Date.parse(snapshot?.createdAt ?? inspection.transaction?.startedAt ?? '');

  // 1. Unstage what the close staged, keeping whatever was staged before it began.
  const preStaged = new Set(snapshot?.preCloseStagedFiles ?? []);
  const unstage = stagedFiles(cwd).filter((filePath) => isTaskOwnedPath(taskId, filePath, cardPath) && !preStaged.has(filePath));
  if (unstage.length > 0) execFileSync('git', ['restore', '--staged', '--', ...unstage], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  // 2. Archive the files the close created (close transitions, closure packet, seal receipt).
  const archived: ArchivedArtifact[] = [];
  const closeEvents = listTaskEvents(cwd, taskId).filter((entry) => CLOSE_ACTIONS.has(String(entry.event?.action ?? ''))
    && (!Number.isFinite(startedMs) || eventTime(entry) >= startedMs - 1000) && !isTrackedAtHead(cwd, entry.relativePath));
  for (const entry of closeEvents) archiveFile(cwd, entry.relativePath, archiveRoot, archived);
  const closurePacket = typeof (index ?? working)?.document.closurePacket === 'string' ? String((index ?? working)!.document.closurePacket) : snapshot?.closurePacketPath ?? null;
  for (const candidate of [closurePacket, `.atm/history/evidence/${taskId}.seal-and-commit.json`, snapshot?.closeCommitWindowPath ?? null]) {
    if (candidate && !isTrackedAtHead(cwd, candidate)) archiveFile(cwd, candidate, archiveRoot, archived);
  }

  // 3. Restore the ledger to its pre-close content.
  const restored: Array<{ path: string; source: string; sha256: string | null }> = [];
  const workingIsClosed = working !== null && CLOSED_STATUSES.has(working.status ?? '');
  if (snapshot && snapshot.previousTaskContent && workingIsClosed) {
    writeFileSync(workingAbsolute, snapshot.previousTaskContent, 'utf8');
    restored.push({ path: ledgerPath, source: 'pre-close-snapshot', sha256: sha256Text(snapshot.previousTaskContent) });
  } else if (working) {
    // No snapshot (or the ledger was reopened after the close): keep later
    // governed changes, drop what the close added.
    const document: Record<string, unknown> = { ...working.document };
    if (workingIsClosed) document.status = inspection.closeTransition?.fromStatus ?? 'running';
    for (const key of LEDGER_CLOSE_FIELDS) delete document[key];
    const claim = document.claim as Record<string, unknown> | undefined;
    if (claim && claim.reason === 'closed') {
      const { reason: _closed, ...rest } = claim;
      document.claim = { ...rest, state: 'active' };
    }
    const archivedIds = new Set(archived.map((entry) => path.basename(entry.path, '.json')));
    if (typeof document.lastTransitionId === 'string' && archivedIds.has(document.lastTransitionId)) {
      const remaining = listTaskEvents(cwd, taskId).pop();
      document.lastTransitionId = remaining?.transitionId ?? null;
      document.lastTransitionAt = remaining?.event?.createdAt ?? null;
    }
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (text !== working.text) {
      writeFileSync(workingAbsolute, text, 'utf8');
      restored.push({ path: ledgerPath, source: workingIsClosed ? 'reconstructed-from-close-transition' : 'close-fields-removed', sha256: sha256Text(text) });
    }
  }

  // 4. Restore the planning card: pre-close snapshot, else HEAD, else strip close metadata; prefer whichever matches the sealed digest.
  let card: { path: string | null; source: string | null; matchesSeal: boolean | null } = { path: cardPath, source: null, matchesSeal: null };
  if (cardPath) {
    const absolute = path.join(cwd, cardPath);
    const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    const sealed = sealedCardDigest(working ?? index);
    const cardEvent = closeEvents.map((entry) => entry.event).find((event) => event?.taskPath === cardPath) ?? null;
    const candidates: Array<{ source: string; text: string | null }> = [
      { source: 'pre-close-snapshot', text: snapshot?.planningCard?.previousContent ?? null },
      { source: 'head', text: git(cwd, ['show', `HEAD:${cardPath}`]) },
      { source: 'close-metadata-stripped', text: current ? stripCardCloseMetadata(current, typeof cardEvent?.fromStatus === 'string' ? cardEvent.fromStatus : null) : null }
    ];
    const chosen = candidates.find((entry) => entry.text !== null && sealed !== null && sha256Text(entry.text) === sealed)
      ?? candidates.slice(0, 2).find((entry) => entry.text !== null) ?? null;
    if (chosen?.text != null && chosen.text !== current) {
      writeFileSync(absolute, chosen.text, 'utf8');
      restored.push({ path: cardPath, source: chosen.source, sha256: sha256Text(chosen.text) });
    }
    const finalText = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    card = { path: cardPath, source: chosen?.source ?? null, matchesSeal: sealed === null || finalText === null ? null : sha256Text(finalText) === sealed };
  }

  // 5. Terminal transaction, released lock, cleared runtime, auditable receipt.
  writeCloseTransactionStatus({ cwd, taskId, phase: 'rolled-back', outcome: 'rolled-back', failure: `aborted by governed close recovery (${input.actorId}): ${input.reason}` });
  const released = releaseCloseWindowStagedIndexLock({ cwd, taskId, actorId: input.actorId, outcome: 'aborted' });
  const mutexRemoved = releaseDeadHolderMutex(inspection.holder);
  if (snapshot) {
    mkdirSync(archiveRoot, { recursive: true });
    renameSync(closeRecoverySnapshotPath(cwd, taskId), path.join(archiveRoot, path.basename(closeRecoverySnapshotPath(cwd, taskId))));
  }
  const receiptPath = appendRecoveryReceipt(cwd, taskId, {
    recoveryId, action: 'abort', actorId: input.actorId, reason: input.reason, at: new Date().toISOString(), before: inspectionSummary(inspection),
    unstaged: unstage, archived, restored, card, lockReleased: released ? released.releaseOutcome : null, deadMutexRemoved: mutexRemoved,
    archiveRoot: relativePathFrom(cwd, archiveRoot)
  });
  return { recoveryId, unstaged: unstage, archived, restored, card, lockReleased: released !== null, mutexRemoved, receiptPath };
}

export async function runTaskflowCloseRecovery(parsed: ReturnType<typeof parseArgsForCommand>, cwd: string) {
  const options = parsed.options as Record<string, unknown>;
  const taskId = String(options.task ?? '').trim();
  const mode: 'recover' | 'abort' = options.abort ? 'abort' : 'recover';
  if (!taskId) throw new CliError('ATM_CLI_USAGE', `taskflow close --${mode} requires --task <id>.`, { exitCode: 2 });
  if (options.recover && options.abort) throw new CliError('ATM_CLI_USAGE', 'taskflow close takes either --recover or --abort, not both.', { exitCode: 2 });
  const write = options.write === true;
  const actorId = String(options.actor ?? process.env.ATM_ACTOR_ID ?? '').trim();
  const reason = String(options.reason ?? '').trim() || `governed ${mode} of an interrupted taskflow close`;
  if (write && !actorId) throw new CliError('ATM_CLI_USAGE', `taskflow close --${mode} --write requires --actor <id>.`, { exitCode: 2 });
  const inspection = inspectCloseRecovery({ cwd, taskId, staleAfterMs: resolveCloseRecoveryStaleAfterMs(options.staleAfterMs) });
  const base = { command: 'taskflow close', cwd, mode: write ? 'write' : 'dry-run' };
  const done = (ok: boolean, level: 'info' | 'warn' | 'error', code: string, text: string, evidence: Record<string, unknown> = {}) => ({
    ...makeResult({ ...base, ok, messages: [message(level, code, text, { taskId, state: inspection.state })], evidence: { action: mode, taskId, inspection, ...evidence } }),
    schemaId: 'atm.taskflowCloseRecoveryResult.v1', writeEnabled: write
  });
  if (inspection.state === 'holder-alive') {
    return done(false, 'error', 'ATM_CLOSE_RECOVERY_HOLDER_ALIVE', `The close of ${taskId} may still be running (${inspection.holder.reason}); recovery refused.`);
  }
  if (inspection.state === 'nothing-to-recover') {
    return done(true, 'info', 'ATM_CLOSE_RECOVERY_NOTHING_TO_RECOVER', `No interrupted close to ${mode} for ${taskId}.`);
  }
  if (mode === 'abort' && inspection.landed) {
    return done(false, 'error', 'ATM_CLOSE_RECOVERY_ALREADY_LANDED', `The close of ${taskId} already landed on HEAD (${inspection.landedCommit ?? 'unknown commit'}); use --recover, never a second close or an abort.`, { requiredCommand: closeRecoveryCommand(taskId, 'recover') });
  }
  if (mode === 'abort' && !inspection.abort.possible) {
    return done(false, 'error', 'ATM_CLOSE_RECOVERY_ABORT_UNSAFE', `Abort of ${taskId} is unsafe: ${inspection.abort.reasons.join('; ')}.`);
  }
  if (mode === 'recover' && !inspection.rollForward.possible) {
    return done(false, 'error', 'ATM_CLOSE_RECOVERY_ROLL_FORWARD_INCONSISTENT', `Roll-forward of ${taskId} is not consistent: ${inspection.rollForward.reasons.join('; ')}.`, { requiredCommand: inspection.abort.possible ? closeRecoveryCommand(taskId, 'abort') : null });
  }
  if (!write) {
    const plan = mode === 'abort' ? 'abort the interrupted close (unstage, archive close artifacts, restore ledger and card, release the lock as aborted)'
      : inspection.landed ? 'mark the landed close completed and release the lock as committed'
        : 'commit the staged close bundle through the governed commit, then mark it completed and release the lock as committed';
    return done(true, 'info', 'ATM_CLOSE_RECOVERY_DRY_RUN', `Dry run: --write would ${plan} for ${taskId}.`, { writeCommand: `${closeRecoveryCommand(taskId, mode).replace('<actor-id>', actorId || '<actor-id>')} --write`.replace(' --json --write', ' --write --json') });
  }
  if (mode === 'abort') {
    const result = abortInterruptedClose({ cwd, taskId, actorId, reason, inspection });
    return done(true, 'info', 'ATM_CLOSE_RECOVERY_ABORTED', `Aborted the interrupted close of ${taskId}; the lock is released and the task can be closed again.`, { result, after: inspectCloseRecovery({ cwd, taskId }) });
  }
  const commitSha = inspection.landed ? null : await commitStagedClose({ cwd, taskId, actorId, reason, inspection });
  const result = finalizeLanded({ cwd, taskId, actorId, reason, inspection, commitSha, mode });
  return done(true, 'info', 'ATM_CLOSE_RECOVERY_COMPLETED', `Recovered the interrupted close of ${taskId} as completed (${result.targetCommit ?? 'no commit'}).`, { result, after: inspectCloseRecovery({ cwd, taskId }) });
}
