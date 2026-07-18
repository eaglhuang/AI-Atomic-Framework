import path from 'node:path';
import { CliError } from '../../shared.ts';
import { normalizeRelativePath, parseCsvPathList, requireValue } from './helpers.ts';

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
    if (arg === '--add' || arg === '--paths') {
      const raw = requireValue(argv, index, arg);
      // Accumulate repeated --add/--paths flags; last-wins silently dropped prior paths (ATM-BUG-2026-07-16-010).
      options.addPaths = [...options.addPaths, ...parseCsvPathList(raw)];
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
    throw new CliError('ATM_CLI_USAGE', 'tasks scope add requires --add <paths> (comma-separated). Alias: --paths <paths>.', { exitCode: 2 });
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
      // Accumulate repeated --add flags (same semantics as tasks scope add).
      options.addPaths = [...options.addPaths, ...parseCsvPathList(raw)];
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
