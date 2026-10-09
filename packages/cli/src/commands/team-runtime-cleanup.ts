import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonFile, relativePathFrom } from './shared.ts';

const terminalTaskStatuses = new Set(['done', 'abandoned', 'blocked']);

type TeamRunCleanupRecord = {
  teamRunId: string;
  taskId: string;
  path: string;
  reason: 'terminal-task';
  terminalTaskStatus: string;
};

export function cleanupStaleTeamRunsForTerminalTasks(input: {
  cwd: string;
  taskId?: string;
  terminalTaskStatus?: string | null;
  onRemoved?: (absolutePath: string, previousBytes: Buffer) => void;
}) {
  const directory = path.join(input.cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) {
    return [] as TeamRunCleanupRecord[];
  }

  const cleaned: TeamRunCleanupRecord[] = [];
  for (const entry of readdirSync(directory).filter((name) => name.endsWith('.json')).sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(directory, entry);
    const decisionBytes = readFileSync(absolutePath);
    const run = readJsonFile(absolutePath, 'ATM_TEAM_RUN_INVALID') as Record<string, unknown>;
    const taskId = normalizeOptionalString(run.taskId);
    if (!taskId) continue;
    if (input.taskId && taskId !== input.taskId) continue;
    if (normalizeOptionalString(run.status) !== 'active') continue;

    const terminalTaskStatus = resolveTerminalTaskStatus(input.cwd, taskId, input);
    if (!terminalTaskStatus) continue;

    if (!lstatSync(absolutePath).isFile()) throw new Error(`Refusing non-file Team run cleanup: ${absolutePath}`);
    const previousBytes = readFileSync(absolutePath);
    // Bind deletion to the bytes used for this decision, not a later replacement.
    if (!previousBytes.equals(decisionBytes)) {
      throw new Error(`Team run changed during cleanup: ${absolutePath}`);
    }
    rmSync(absolutePath, { force: true });
    input.onRemoved?.(absolutePath, previousBytes);
    cleaned.push({
      teamRunId: normalizeOptionalString(run.teamRunId) ?? path.basename(entry, '.json'),
      taskId,
      path: relativePathFrom(input.cwd, absolutePath),
      reason: 'terminal-task',
      terminalTaskStatus
    });
  }
  return cleaned;
}

/** Keep removed bytes only for the lifetime of the existing close transaction. */
export function createTerminalTeamRunCleanupTransaction(input: {
  cwd: string;
  taskId: string;
  terminalTaskStatus: string;
}) {
  const removed = new Map<string, Buffer>();
  return {
    recoveryRecords: () => [...removed].map(([absolutePath, bytes]) => ({ path: relativePathFrom(input.cwd, absolutePath), bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') })),
    cleanup: () => cleanupStaleTeamRunsForTerminalTasks({
      ...input,
      onRemoved: (absolutePath, bytes) => { removed.set(absolutePath, bytes); }
    }),
    rollback: () => {
      const errors: unknown[] = [];
      for (const [absolutePath, bytes] of removed) {
        try {
          if (existsSync(absolutePath)) {
            if (!lstatSync(absolutePath).isFile() || !readFileSync(absolutePath).equals(bytes)) {
              throw new Error(`Refusing to overwrite changed Team run during rollback: ${absolutePath}`);
            }
          } else {
            writeFileSync(absolutePath, bytes, { flag: 'wx' });
          }
        } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Team run cleanup rollback failed');
    }
  };
}

function resolveTerminalTaskStatus(
  cwd: string,
  taskId: string,
  input: { taskId?: string; terminalTaskStatus?: string | null }
) {
  if (input.taskId === taskId) {
    return normalizeTerminalTaskStatus(input.terminalTaskStatus);
  }
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return null;
  const taskDocument = readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID') as Record<string, unknown>;
  return normalizeTerminalTaskStatus(taskDocument.status);
}

function normalizeTerminalTaskStatus(value: unknown) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  return terminalTaskStatuses.has(normalized) ? normalized : null;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
