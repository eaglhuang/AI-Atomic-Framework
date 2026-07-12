import path from 'node:path';
import { CliError } from '../shared.ts';
import { coerceStatus } from './task-import-validators.ts';
import type { TaskImportStatus } from '../tasks.ts';

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parseAllowStaleRunnerFlag(argv: readonly string[]): boolean {
  return argv.includes('--allow-stale-runner');
}

export function parseStatusOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    residueOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--residue') {
      options.residueOnly = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks status does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks status requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    residueOnly: options.residueOnly
  };
}

export function parseFinalizeDiagnoseOptions(argv: string[]) {
  const statusOptions = parseStatusOptions(argv);
  return statusOptions;
}

export function parseReconcileOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    deliveryCommit: '',
    waiverOutOfScopeDelivery: false,
    waiverReason: null as string | null,
    emergencyApproval: null as string | null,
    allowStaleRunner: parseAllowStaleRunnerFlag(argv)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--delivery-commit' || arg === '--historical-delivery') {
      options.deliveryCommit = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--waiver-out-of-scope-delivery' || arg === '--waive-out-of-scope') {
      options.waiverOutOfScopeDelivery = true;
      continue;
    }
    if (arg === '--reason') {
      options.waiverReason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks reconcile does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks reconcile requires --task <work-item-id>.', { exitCode: 2 });
  }
  if (!options.deliveryCommit) {
    throw new CliError('ATM_CLI_USAGE', 'tasks reconcile requires --delivery-commit <commit-sha>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    deliveryCommit: options.deliveryCommit.trim(),
    waiverReason: options.waiverReason?.trim() || null
  };
}

export function parseDeliverAndCloseOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    deliveryCommit: null as string | null,
    message: null as string | null,
    reason: null as string | null,
    dryRun: false,
    fromBatchCheckpoint: false,
    batchId: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--delivery-commit' || arg === '--historical-delivery') {
      options.deliveryCommit = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--message') {
      options.message = requireValue(argv, index, '--message');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--from-batch-checkpoint') {
      options.fromBatchCheckpoint = true;
      continue;
    }
    if (arg === '--batch') {
      options.batchId = requireValue(argv, index, '--batch');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks deliver-and-close does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks deliver-and-close requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}

export function parseScopeAddOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    claimFirst: false,
    emergencyApproval: null as string | null,
    addPaths: [] as string[],
    /** 修改類型：doc-sync | help-snapshot-sync | test-alignment | generated-artifact | linked-surface */
    amendmentClass: null as string | null,
    /** 修改階段：pre-implementation | during-implementation | closeout */
    amendmentPhase: null as string | null,
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--claim-first') {
      options.claimFirst = true;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--add') {
      const raw = requireValue(argv, index, '--add');
      options.addPaths = raw.split(',').map((p) => p.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--class') {
      options.amendmentClass = requireValue(argv, index, '--class');
      index += 1;
      continue;
    }
    if (arg === '--phase') {
      options.amendmentPhase = requireValue(argv, index, '--phase');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks scope add does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope add requires --task <work-item-id>.', { exitCode: 2 });
  }
  if (options.addPaths.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope add requires --add <paths> (comma-separated).', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    reason: options.reason?.trim() || null
  };
}

/**
 * 解析 `tasks scope repair` 維護緊急通道的選項。
 * 與 `parseScopeAddOptions` 相似，但強制要求 `--emergency-approval` 和 `--reason`。
 */
export function parseScopeRepairOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    emergencyApproval: null as string | null,
    addPaths: [] as string[],
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--add') {
      const raw = requireValue(argv, index, '--add');
      options.addPaths = raw.split(',').map((p) => p.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks scope repair does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair requires --task <work-item-id>.', { exitCode: 2 });
  }
  if (options.addPaths.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair requires --add <paths> (comma-separated).', { exitCode: 2 });
  }
  if (!options.emergencyApproval) {
    throw new CliError('ATM_SCOPE_REPAIR_EMERGENCY_APPROVAL_REQUIRED',
      'tasks scope repair requires --emergency-approval <leaseId>. This is a protected maintenance lane; use tasks scope add for normal audited scope amendment.',
      { exitCode: 2 });
  }
  if (!options.reason) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair requires --reason <text> to document the governance exception.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    reason: options.reason.trim()
  };
}

export function parseMetadataRepairDeliverablesOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    setPaths: [] as string[],
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--set') {
      const raw = requireValue(argv, index, '--set');
      options.setPaths = raw.split(',').map((p) => p.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks scope repair-deliverables does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair-deliverables requires --task <work-item-id>.', { exitCode: 2 });
  }
  if (options.setPaths.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair-deliverables requires --set <paths> (comma-separated).', { exitCode: 2 });
  }
  if (!options.reason) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope repair-deliverables requires --reason <text>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    reason: options.reason.trim()
  };
}

export function parseCreateOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    title: null as string | null,
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--title') {
      options.title = requireValue(argv, index, '--title');
      index += 1;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks create does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks create requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}

export function parseMirrorOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: null as string | null,
    actorId: null as string | null,
    provider: '',
    originTaskId: '',
    originUrl: null as string | null,
    title: null as string | null,
    status: 'planned' as TaskImportStatus,
    syncStatus: 'mirrored'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--provider') {
      options.provider = requireValue(argv, index, '--provider');
      index += 1;
      continue;
    }
    if (arg === '--origin-task' || arg === '--origin-task-id') {
      options.originTaskId = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--origin-url') {
      options.originUrl = requireValue(argv, index, '--origin-url');
      index += 1;
      continue;
    }
    if (arg === '--title') {
      options.title = requireValue(argv, index, '--title');
      index += 1;
      continue;
    }
    if (arg === '--status') {
      options.status = coerceStatus(requireValue(argv, index, '--status'));
      index += 1;
      continue;
    }
    if (arg === '--sync-status') {
      options.syncStatus = requireValue(argv, index, '--sync-status');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks mirror does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.provider) {
    throw new CliError('ATM_CLI_USAGE', 'tasks mirror requires --provider <id>.', { exitCode: 2 });
  }
  if (!options.originTaskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks mirror requires --origin-task <id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    provider: options.provider.trim(),
    originTaskId: options.originTaskId.trim(),
    taskId: options.taskId?.trim() || null
  };
}

export function parseHistoricalDeliveryRefs(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseCloseOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    status: 'done' as 'done' | 'review' | 'blocked' | 'abandoned',
    reason: null as string | null,
    fromBatchCheckpoint: false,
    batchId: null as string | null,
    historicalDeliveryRefs: [] as string[],
    historicalBatchRef: null as string | null,
    historicalDeliveryRepo: null as string | null,
    waiverOutOfScopeDelivery: false,
    emergencyApproval: null as string | null,
    allowStaleRunner: parseAllowStaleRunnerFlag(argv)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--status') {
      const nextStatus = requireValue(argv, index, '--status').trim().toLowerCase();
      if (nextStatus !== 'done' && nextStatus !== 'review' && nextStatus !== 'blocked' && nextStatus !== 'abandoned') {
        throw new CliError('ATM_CLI_USAGE', 'tasks close --status supports only: done, review, blocked, abandoned.', { exitCode: 2 });
      }
      options.status = nextStatus;
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--from-batch-checkpoint') {
      options.fromBatchCheckpoint = true;
      continue;
    }
    if (arg === '--batch') {
      options.batchId = requireValue(argv, index, '--batch');
      index += 1;
      continue;
    }
    if (arg === '--historical-delivery' || arg === '--historical-delivery-commit' || arg === '--delivery-commit') {
      options.historicalDeliveryRefs.push(...parseHistoricalDeliveryRefs(requireValue(argv, index, arg)));
      index += 1;
      continue;
    }
    if (arg === '--historical-batch') {
      options.historicalBatchRef = requireValue(argv, index, '--historical-batch');
      index += 1;
      continue;
    }
    if (arg === '--historical-delivery-repo' || arg === '--delivery-repo' || arg === '--planning-delivery-repo') {
      options.historicalDeliveryRepo = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--waiver-out-of-scope-delivery' || arg === '--waive-out-of-scope') {
      options.waiverOutOfScopeDelivery = true;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks close does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks close requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    historicalDeliveryRefs: uniqueStrings(options.historicalDeliveryRefs),
    historicalDeliveryRepo: options.historicalDeliveryRepo ? path.resolve(options.historicalDeliveryRepo) : null,
    reason: options.reason?.trim() || null
  };
}

export function parseResetOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    emergencyApproval: null as string | null,
    to: 'open',
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--to') {
      options.to = requireValue(argv, index, '--to').trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    throw new CliError('ATM_CLI_USAGE', `tasks reset does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks reset requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}

export function parseAuditOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    staged: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg === '--staged') {
      options.staged = true;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks audit does not support option ${arg}`, { exitCode: 2 });
  }
  return {
    cwd: path.resolve(options.cwd),
    staged: options.staged
  };
}

export function parseQueueOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    queueId: null as string | null,
    actorId: null as string | null,
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--queue') {
      options.queueId = requireValue(argv, index, '--queue');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks queue does not support option ${arg}`, { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    queueId: options.queueId?.trim() || null
  };
}

export function parseLockCleanupOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    reason: null as string | null,
    emergencyApproval: null as string | null,
    allStale: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--all-stale') {
      options.allStale = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks lock cleanup does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId && !options.allStale) {
    throw new CliError('ATM_CLI_USAGE', 'tasks lock cleanup requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}

export function parseLegacyLedgerMigrationOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    actorId: null as string | null,
    dryRun: false,
    apply: false,
    reason: 'Backfilled task-ledger/v1 baseline transition for legacy task state that predates CLI-controlled task transitions.'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks migrate-legacy-ledger does not support option ${arg}`, { exitCode: 2 });
  }
  if (options.apply === options.dryRun) {
    throw new CliError('ATM_CLI_USAGE', 'tasks migrate-legacy-ledger requires exactly one of --dry-run or --apply.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd)
  };
}

export function parseClaimLifecycleOptions(action: 'claim' | 'renew' | 'release' | 'handoff' | 'takeover', argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    files: [] as string[],
    ttlSeconds: 1800,
    handoffTo: null as string | null,
    reason: null as string | null,
    reservedOk: false,
    // TASK-CID-0024: closeout-only / no-more-mutation claim intent. 'write' is
    // the normal mutating claim; 'closeout-only' is a non-mutating claim whose
    // deliverable already landed and only governed closeout work remains.
    claimIntent: 'write' as 'write' | 'closeout-only',
    autoIntent: false,
    claimIntentExplicit: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--files') {
      options.files = requireValue(argv, index, '--files').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--ttl-seconds') {
      const raw = requireValue(argv, index, '--ttl-seconds');
      const ttl = Number.parseInt(raw, 10);
      if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new CliError('ATM_CLI_USAGE', 'tasks requires --ttl-seconds to be a positive integer.', { exitCode: 2 });
      }
      options.ttlSeconds = ttl;
      index += 1;
      continue;
    }
    if (arg === '--to') {
      options.handoffTo = requireValue(argv, index, '--to');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--reserved-ok') {
      options.reservedOk = true;
      continue;
    }
    if (arg === '--auto-intent') {
      if (action !== 'claim') {
        throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --auto-intent`, { exitCode: 2 });
      }
      options.autoIntent = true;
      continue;
    }
    if (arg === '--closeout-only' || arg === '--no-more-mutation') {
      if (action !== 'claim') {
        throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option ${arg}`, { exitCode: 2 });
      }
      options.claimIntent = 'closeout-only';
      options.claimIntentExplicit = true;
      options.autoIntent = false;
      continue;
    }

    if (arg === '--claim-intent') {
      if (action !== 'claim') {
        throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --claim-intent`, { exitCode: 2 });
      }
      const raw = requireValue(argv, index, '--claim-intent').trim().toLowerCase();
      const normalized = raw === 'no-more-mutation' ? 'closeout-only' : raw;
      if (normalized !== 'write' && normalized !== 'closeout-only') {
        throw new CliError('ATM_CLI_USAGE', 'tasks claim requires --claim-intent to be one of: write, closeout-only, no-more-mutation.', {
          exitCode: 2,
          details: { claimIntent: raw, allowedValues: ['write', 'closeout-only', 'no-more-mutation'] }
        });
      }
      options.claimIntent = normalized;
      options.claimIntentExplicit = true;
      options.autoIntent = false;
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', `tasks ${action} requires --task <work-item-id>.`, { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}
