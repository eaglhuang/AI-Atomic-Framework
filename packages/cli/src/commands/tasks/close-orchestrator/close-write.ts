import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  executeTaskCloseTransaction,
  type ClosurePacket,
  writeClosurePacket
} from '../../framework-development.ts';
import {
  buildTaskTransitionCommand,
  createClosureTransitionMetadata,
  writeTaskDocumentWithTransition
} from '../close-helpers/task-transition-writer.ts';

type AbandonResidueDispositionClass = 'keep-diagnostic' | 'abandon' | 'remove-evidence';

function normalizeRel(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function listStagedPaths(cwd: string): string[] {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return out.split('\0').map((entry) => normalizeRel(entry.trim())).filter(Boolean);
  } catch {
    return [];
  }
}

function isAbandonedTaskOwnedPath(taskId: string, filePath: string): boolean {
  const lower = normalizeRel(filePath).toLowerCase();
  const id = taskId.toLowerCase();
  return lower === `.atm/history/tasks/${id}.json`
    || lower.startsWith(`.atm/history/evidence/${id}.`)
    || lower.startsWith(`.atm/history/task-events/${id}/`);
}

/**
 * ATM-GOV-0181 / ATM-BUG-2026-07-12-147:
 * After abandon, remove only disposable generated residue (bundle-manifest),
 * unstage abandoned-task ownership paths so the next lane is not foreign-staged,
 * and record an explicit disposition packet that keeps the audit trail admissible.
 */
export function applyAbandonedResidueDisposition(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly reason: string | null;
}): {
  readonly dispositionPath: string;
  readonly disposition: AbandonResidueDispositionClass;
  readonly removed: readonly string[];
  readonly unstaged: readonly string[];
  readonly keptAuditTrail: readonly string[];
} {
  const taskId = input.taskId.trim().toUpperCase();
  const removed: string[] = [];
  const unstaged: string[] = [];
  const keptAuditTrail: string[] = [];

  const bundleManifestRel = `.atm/history/evidence/${taskId}.bundle-manifest.json`;
  const bundleAbs = path.join(input.cwd, bundleManifestRel);
  if (existsSync(bundleAbs)) {
    try {
      execFileSync('git', ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', bundleManifestRel], {
        cwd: input.cwd,
        stdio: 'ignore'
      });
    } catch {
      // best-effort unstage before unlink
    }
    try {
      unlinkSync(bundleAbs);
      removed.push(bundleManifestRel);
    } catch {
      // if unlink fails, leave for commit-gate auto-clean
    }
  }

  for (const rel of [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`
  ]) {
    if (existsSync(path.join(input.cwd, rel))) keptAuditTrail.push(rel);
  }
  if (existsSync(path.join(input.cwd, '.atm', 'history', 'task-events', taskId))) {
    keptAuditTrail.push(`.atm/history/task-events/${taskId}/`);
  }

  const toUnstage = listStagedPaths(input.cwd).filter((filePath) => isAbandonedTaskOwnedPath(taskId, filePath));
  if (toUnstage.length > 0) {
    try {
      execFileSync('git', ['restore', '--staged', '--', ...toUnstage], { cwd: input.cwd, stdio: 'ignore' });
      unstaged.push(...toUnstage);
    } catch {
      try {
        execFileSync('git', ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...toUnstage], {
          cwd: input.cwd,
          stdio: 'ignore'
        });
        unstaged.push(...toUnstage);
      } catch {
        // leave staged; commit-gate / defer remains available as fallback
      }
    }
  }

  const disposition: AbandonResidueDispositionClass = removed.length > 0 ? 'remove-evidence' : 'keep-diagnostic';
  const dispositionRel = `.atm/history/evidence/${taskId}.abandon-residue-disposition.json`;
  const dispositionAbs = path.join(input.cwd, dispositionRel);
  mkdirSync(path.dirname(dispositionAbs), { recursive: true });
  writeFileSync(dispositionAbs, `${JSON.stringify({
    schemaId: 'atm.abandonResidueDisposition.v1',
    taskId,
    actorId: input.actorId,
    reason: input.reason,
    disposition,
    classes: {
      'keep-diagnostic': keptAuditTrail,
      abandon: [] as string[],
      'remove-evidence': removed
    },
    removed,
    unstaged,
    keptAuditTrail,
    recordedAt: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
  keptAuditTrail.push(dispositionRel);

  return {
    dispositionPath: dispositionRel,
    disposition,
    removed,
    unstaged,
    keptAuditTrail
  };
}

export async function executeCloseWrites(input: {
  readonly options: any;
  readonly actorId: string;
  readonly taskPath: string;
  readonly previousTaskContent: string;
  readonly taskDocument: Record<string, unknown>;
  readonly activeSession: { readonly sessionId?: string | null } | null;
  readonly previousStatus: string;
  readonly owningBatch: { readonly batchId?: string | null } | null;
  readonly effectiveHistoricalDeliveryRefs: readonly string[];
  readonly pendingClosurePacket: ClosurePacket | null;
  readonly createdClosurePacketAbsolute: string | null;
  readonly closurePacketPath: string | null;
  readonly closurePacket: ClosurePacket | null;
}) {
  const { options, actorId } = input;
  let closurePacketPath = input.closurePacketPath;
  let closurePacket = input.closurePacket;
  const closeTransitionCommand = buildTaskTransitionCommand({
    action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
    taskId: options.taskId,
    actorId,
    status: options.status,
    fromBatchCheckpoint: options.fromBatchCheckpoint,
    batchId: input.owningBatch?.batchId ?? options.batchId,
    historicalDeliveryRefs: input.effectiveHistoricalDeliveryRefs
  });
  const closeWriteResult = await executeTaskCloseTransaction({
    cwd: options.cwd,
    taskId: options.taskId,
    taskPath: input.taskPath,
    phase: 'close',
    previousTaskContent: input.previousTaskContent,
    createdClosurePacketAbsolute: input.createdClosurePacketAbsolute,
    runWrites: () => {
      if (input.pendingClosurePacket) {
        closurePacketPath = writeClosurePacket(options.cwd, options.taskId, input.pendingClosurePacket);
        closurePacket = input.pendingClosurePacket;
        input.taskDocument.closurePacket = closurePacketPath;
      }
      let abandonResidueDispositionPath: string | null = null;
      if (options.status === 'abandoned') {
        const disposition = applyAbandonedResidueDisposition({
          cwd: options.cwd,
          taskId: options.taskId,
          actorId,
          reason: typeof options.reason === 'string' ? options.reason : null
        });
        abandonResidueDispositionPath = disposition.dispositionPath;
        input.taskDocument.abandonResidueDisposition = disposition.dispositionPath;
      }
      const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath: input.taskPath,
        taskId: options.taskId,
        taskDocument: input.taskDocument,
        action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
        actorId,
        sessionId: input.activeSession?.sessionId ?? null,
        previousStatus: input.previousStatus,
        closureMetadata: options.status === 'done'
          ? createClosureTransitionMetadata(closurePacketPath, closurePacket, input.owningBatch?.batchId ?? options.batchId, input.activeSession?.sessionId ?? null)
          : null,
        command: closeTransitionCommand
      });
      return { transitionPath, closurePacketPath, abandonResidueDispositionPath };
    }
  });
  return {
    transitionPath: closeWriteResult.transitionPath,
    closurePacketPath: closeWriteResult.closurePacketPath ?? closurePacketPath
  };
}
