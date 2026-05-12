import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { CliError, makeResult, message } from './shared.mjs';

export function runLock(argv) {
  const options = parseLockArgs(argv);
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const existingTask = adapter.stores.taskStore.getTask(options.taskId);
  const task = existingTask ?? {
    workItemId: options.taskId,
    title: options.taskId,
    status: 'open'
  };

  if (options.action === 'check') {
    const lock = adapter.stores.lockStore.getLock(options.taskId);
    const ok = lock !== null;
    return makeResult({
      ok,
      command: 'lock',
      cwd: options.cwd,
      messages: [ok ? message('info', 'ATM_LOCK_FOUND', 'Scope lock is active.', { taskId: options.taskId }) : message('info', 'ATM_LOCK_MISSING', 'No active scope lock was found.', { taskId: options.taskId })],
      evidence: { taskId: options.taskId, lock: lock ?? null }
    });
  }

  if (options.action === 'acquire') {
    const lock = adapter.stores.lockStore.acquireLock(task, options.files.length > 0 ? options.files : [`.atm/history/tasks/${options.taskId}.json`], options.owner);
    return makeResult({
      ok: true,
      command: 'lock',
      cwd: options.cwd,
      messages: [message('info', 'ATM_LOCK_ACQUIRED', 'Scope lock acquired.', { taskId: options.taskId, owner: options.owner })],
      evidence: { taskId: options.taskId, lock }
    });
  }

  const released = adapter.stores.lockStore.releaseLock(options.taskId, options.owner);
  return makeResult({
    ok: true,
    command: 'lock',
    cwd: options.cwd,
    messages: [message('info', 'ATM_LOCK_RELEASED', 'Scope lock released.', { taskId: options.taskId, owner: options.owner })],
    evidence: { taskId: options.taskId, result: released }
  });
}

function parseLockArgs(argv) {
  const state = {
    cwd: process.cwd(),
    action: null,
    taskId: null,
    owner: 'atm-agent',
    files: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--owner') {
      state.owner = requireValue(argv, index, '--owner');
      index += 1;
      continue;
    }
    if (arg === '--files') {
      state.files = requireValue(argv, index, '--files').split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `lock does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'lock accepts only one action', { exitCode: 2 });
    }
    state.action = arg;
  }

  if (!['check', 'acquire', 'release'].includes(state.action ?? '')) {
    throw new CliError('ATM_CLI_USAGE', 'lock supports: check, acquire, release', { exitCode: 2 });
  }
  if (!state.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'lock requires --task <task-id>', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    taskId: state.taskId,
    owner: state.owner,
    files: state.files
  };
}

function requireValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `lock requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
