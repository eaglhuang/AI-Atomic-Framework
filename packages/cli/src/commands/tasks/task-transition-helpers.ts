/**
 * task-transition-helpers.ts
 *
 * Task transition / status helpers extracted from tasks.ts.
 * Fully self-contained to avoid circular dependency with tasks.ts.
 */
import { CliError } from '../shared.ts';
import { readTaskLedgerPolicy, type TaskTransitionClosureMetadata } from '../task-ledger.ts';
import type { WorkItemRef } from '@ai-atomic-framework/core';
import type { ClosurePacket } from '../framework-development.ts';

// 在地化 TaskImportStatus（與 tasks.ts export 對齊，避免循環依賴）
type TaskImportStatus =
  | 'planned'
  | 'open'
  | 'in_progress'
  | 'reserved'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'abandoned'
  | 'done';

const validStatuses = new Set<TaskImportStatus>(['planned', 'open', 'in_progress', 'reserved', 'ready', 'running', 'review', 'blocked', 'abandoned', 'done']);

function normalizeTaskStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function quoteCommandValue(value: string): string {
  return /^[A-Za-z0-9._:/\\-]+$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Asserts local task ledger policy is enabled.
 */
export function assertLocalTaskLedgerEnabled(cwd: string, action: string) {
  const taskLedger = readTaskLedgerPolicy(cwd);
  if (!taskLedger.enabled) {
    throw new CliError('ATM_TASK_LEDGER_DISABLED', `tasks ${action} cannot write local task files because taskLedger.enabled is false.`, {
      exitCode: 1,
      details: {
        action,
        provider: taskLedger.provider,
        taskRoot: taskLedger.taskRoot
      }
    });
  }
}

/**
 * Builds standard transition command strings consistently.
 */
export function buildTaskTransitionCommand(input: {
  readonly action: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly status?: string | null;
  readonly fromBatchCheckpoint?: boolean;
  readonly batchId?: string | null;
  readonly historicalDeliveryRefs?: readonly string[];
}): string {
  const parts = ['node', 'atm.mjs', 'tasks', input.action];
  if (input.taskId) {
    parts.push('--task', quoteCommandValue(input.taskId));
  }
  if (input.actorId) {
    parts.push('--actor', quoteCommandValue(input.actorId));
  }
  if (input.status) {
    parts.push('--status', quoteCommandValue(input.status));
  }
  if (input.fromBatchCheckpoint) {
    parts.push('--from-batch-checkpoint');
  }
  if (input.batchId) {
    parts.push('--batch', quoteCommandValue(input.batchId));
  }
  for (const ref of input.historicalDeliveryRefs ?? []) {
    parts.push('--historical-delivery', quoteCommandValue(ref));
  }
  return parts.join(' ');
}

/**
 * 建構 `tasks scope add` / `tasks scope repair` 的可重現指令字串。
 * 正常稽核通道（add）帶 class/phase/reason；維護通道（repair）帶 reason 與
 * emergency-approval。供稽核事件 command 欄位與輸出 requiredCommand 使用，確保兩條
 * 通道的指令格式一致。
 */
export function buildScopeAmendmentCommand(input: {
  readonly mode: 'normal' | 'repair';
  readonly taskId: string;
  readonly actorId: string;
  readonly addPaths: readonly string[];
  readonly amendmentClass?: string | null;
  readonly amendmentPhase?: string | null;
  readonly reason?: string | null;
  readonly emergencyApproval?: string | null;
}): string {
  const subAction = input.mode === 'repair' ? 'repair' : 'add';
  const parts = [
    'node', 'atm.mjs', 'tasks', 'scope', subAction,
    '--task', quoteCommandValue(input.taskId),
    '--actor', quoteCommandValue(input.actorId),
    '--add', quoteCommandValue(input.addPaths.join(','))
  ];
  if (input.mode === 'normal') {
    if (input.amendmentClass) {
      parts.push('--class', quoteCommandValue(input.amendmentClass));
    }
    if (input.amendmentPhase) {
      parts.push('--phase', quoteCommandValue(input.amendmentPhase));
    }
  }
  if (input.reason) {
    parts.push('--reason', quoteCommandValue(input.reason));
  }
  if (input.mode === 'repair' && input.emergencyApproval) {
    parts.push('--emergency-approval', quoteCommandValue(input.emergencyApproval));
  }
  parts.push('--json');
  return parts.join(' ');
}

/**
 * Packs metadata for task closure transitions.
 */
export function createClosureTransitionMetadata(
  closurePacketPath: string | null,
  closurePacket: ClosurePacket | null,
  batchId: string | null = null,
  sessionId: string | null = null
): TaskTransitionClosureMetadata | null {
  if (!closurePacket && !closurePacketPath && !batchId && !sessionId) {
    return null;
  }
  return {
    schemaId: 'atm.taskClosureTransition.v1',
    batchId,
    sessionId,
    closurePacketPath,
    evidenceFreshness: closurePacket?.evidenceFreshness ?? null,
    validationPasses: closurePacket?.validationPasses ?? [],
    requiredGates: closurePacket?.requiredGates ?? [],
    requiredGatesSnapshot: closurePacket?.requiredGatesSnapshot
      ? {
        schemaId: closurePacket.requiredGatesSnapshot.schemaId,
        generatedAt: closurePacket.requiredGatesSnapshot.generatedAt,
        source: closurePacket.requiredGatesSnapshot.source,
        ruleVersion: closurePacket.requiredGatesSnapshot.ruleVersion,
        frameworkMode: closurePacket.requiredGatesSnapshot.frameworkMode,
        repoRole: closurePacket.requiredGatesSnapshot.repoRole,
        changedFiles: [...closurePacket.requiredGatesSnapshot.changedFiles],
        criticalChangedFiles: [...closurePacket.requiredGatesSnapshot.criticalChangedFiles],
        requiredGates: [...closurePacket.requiredGatesSnapshot.requiredGates]
      }
      : null
  };
}

/**
 * Normalizes work item statuses securely.
 */
export function normalizeWorkItemStatus(value: unknown): WorkItemRef['status'] {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (
    normalized === 'planned'
    || normalized === 'reserved'
    || normalized === 'ready'
    || normalized === 'locked'
    || normalized === 'running'
    || normalized === 'review'
    || normalized === 'verified'
    || normalized === 'done'
    || normalized === 'blocked'
    || normalized === 'abandoned'
  ) {
    return normalized as WorkItemRef['status'];
  }
  if (normalized === 'open' || normalized === 'in_progress') {
    return 'ready';
  }
  return 'planned';
}

/**
 * Inspects verify status with aliases check.
 */
export function inspectTaskVerifyStatus(value: unknown): {
  readonly ok: boolean;
  readonly normalizedStatus: string | null;
  readonly warningCode: string | null;
} {
  const normalized = normalizeTaskStatus(value);
  if (validStatuses.has(normalized as TaskImportStatus)) {
    return {
      ok: true,
      normalizedStatus: normalized,
      warningCode: null
    };
  }
  if (normalized === 'closed' || normalized === 'completed') {
    return {
      ok: true,
      normalizedStatus: 'done',
      warningCode: 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS'
    };
  }
  return {
    ok: false,
    normalizedStatus: null,
    warningCode: null
  };
}
