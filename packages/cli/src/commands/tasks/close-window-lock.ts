import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTaskId } from './task-import-validators.ts';
import { normalizeRelativePath } from './task-file-io-helpers.ts';
import { CliError, quoteCliValue, relativePathFrom } from '../shared.ts';

export const CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID = 'atm.closeWindowStagedIndexLock.v1';

export type CloseWindowStagedIndexLockOutcome = 'committed' | 'rolled_back' | 'aborted';

export interface CloseWindowForeignStagedTaskReport {
  readonly taskId: string;
  readonly stagedFiles: readonly string[];
  readonly restoreChoice: string;
  readonly deferCommand: string;
}

export interface CloseWindowStagedIndexLockRecord {
  readonly schemaId: typeof CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly acquiredAt: string;
  readonly status: 'active' | 'released';
  readonly expectedStageFiles: readonly string[];
  readonly foreignStagedSnapshotPath: string | null;
  readonly unexpectedStagedTasks: readonly CloseWindowForeignStagedTaskReport[];
  readonly releasedAt: string | null;
  readonly releaseOutcome: CloseWindowStagedIndexLockOutcome | null;
}

export interface CloseWindowStagedIndexLockReport {
  readonly schemaId: typeof CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID;
  readonly ok: boolean;
  readonly lockPath: string | null;
  readonly lock: CloseWindowStagedIndexLockRecord | null;
  readonly unexpectedStagedTasks: readonly CloseWindowForeignStagedTaskReport[];
  readonly foreignStagedSnapshotPath: string | null;
  readonly blockedCode: string | null;
  readonly blockedSummary: string | null;
}

function resolveGitExecutable(): string {
  const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (process.platform === 'win32') {
    const windowsGit = 'C:\\Program Files\\Git\\cmd\\git.exe';
    if (existsSync(windowsGit)) {
      return windowsGit;
    }
  }
  return 'git';
}

function closeWindowStagedIndexLockPath(cwd: string): string {
  return path.join(cwd, '.atm', 'runtime', 'locks', 'close-window-staged-index.lock.json');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((entry) => normalizeRelativePath(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function readStagedFiles(repoRoot: string): string[] {
  try {
    return uniqueSorted(execFileSync(resolveGitExecutable(), ['diff', '--cached', '--name-only'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/));
  } catch {
    return [];
  }
}

function extractGovernanceTaskId(filePath: string): string | null {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized.startsWith('.atm/history/')) return null;
  const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
  if (tasksMatch) return normalizeTaskId(tasksMatch[1]);
  const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/i);
  if (evidenceMatch) return normalizeTaskId(evidenceMatch[1]);
  const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
  if (eventMatch) return normalizeTaskId(eventMatch[1]);
  return null;
}

export function inspectForeignStagedTasksForCloseWindow(input: {
  cwd: string;
  taskId: string;
  expectedStageFiles: readonly string[];
}): CloseWindowForeignStagedTaskReport[] {
  const expected = new Set(uniqueSorted(input.expectedStageFiles));
  const stagedFiles = readStagedFiles(input.cwd);
  const unexpected = stagedFiles.filter((filePath) => !expected.has(filePath));
  const grouped = new Map<string, string[]>();
  for (const filePath of unexpected) {
    const foreignTaskId = extractGovernanceTaskId(filePath);
    if (!foreignTaskId || foreignTaskId === normalizeTaskId(input.taskId)) continue;
    const bucket = grouped.get(foreignTaskId) ?? [];
    bucket.push(filePath);
    grouped.set(foreignTaskId, bucket);
  }
  return [...grouped.entries()].map(([foreignTaskId, files]) => {
    const uniqueFiles = uniqueSorted(files);
    return {
      taskId: foreignTaskId,
      stagedFiles: uniqueFiles,
      restoreChoice: `Do not silently unstage ${foreignTaskId}. Either wait for that agent to commit, or defer foreign staged files through --defer-foreign-staged and confirm they can restage afterward.`,
      deferCommand: `${quoteCliValue(resolveGitExecutable())} restore --staged -- ${uniqueFiles.map(quoteCliValue).join(' ')}`
    };
  });
}

function readCloseWindowStagedIndexLock(cwd: string): CloseWindowStagedIndexLockRecord | null {
  const lockPath = closeWindowStagedIndexLockPath(cwd);
  if (!existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as CloseWindowStagedIndexLockRecord;
    if (parsed?.schemaId !== CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeForeignStagedSnapshot(cwd: string, taskId: string, files: readonly string[]): string {
  const snapshotPath = `.atm/runtime/snapshots/close-window-foreign-staged-${taskId}-${Date.now()}.json`;
  mkdirSync(path.dirname(path.join(cwd, snapshotPath)), { recursive: true });
  writeFileSync(path.join(cwd, snapshotPath), `${JSON.stringify({
    schemaId: 'atm.closeWindowForeignStagedSnapshot.v1',
    taskId,
    createdAt: new Date().toISOString(),
    files: uniqueSorted(files)
  }, null, 2)}\n`, 'utf8');
  return snapshotPath;
}

function deferForeignStagedFiles(cwd: string, unexpectedStagedTasks: readonly CloseWindowForeignStagedTaskReport[]): string | null {
  if (unexpectedStagedTasks.length === 0) return null;
  const files = uniqueSorted(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
  const snapshotPath = writeForeignStagedSnapshot(cwd, unexpectedStagedTasks[0]?.taskId ?? 'foreign', files);
  execFileSync(resolveGitExecutable(), ['restore', '--staged', '--', ...files], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return snapshotPath;
}

function cleanupForeignStagedSnapshot(cwd: string, snapshotPath: string | null) {
  if (!snapshotPath) return;
  const absolutePath = path.join(cwd, snapshotPath);
  if (!existsSync(absolutePath)) return;
  try {
    unlinkSync(absolutePath);
  } catch {
    // best-effort runtime residue cleanup
  }
}

export function acquireCloseWindowStagedIndexLock(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  expectedStageFiles: readonly string[];
  deferForeignStaged?: boolean;
}): CloseWindowStagedIndexLockReport {
  const lockPath = closeWindowStagedIndexLockPath(input.cwd);
  const existing = readCloseWindowStagedIndexLock(input.cwd);
  if (existing?.status === 'active' && existing.taskId !== normalizeTaskId(input.taskId)) {
    return {
      schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
      ok: false,
      lockPath: relativePathFrom(input.cwd, lockPath),
      lock: existing,
      unexpectedStagedTasks: existing.unexpectedStagedTasks,
      foreignStagedSnapshotPath: existing.foreignStagedSnapshotPath,
      blockedCode: 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED',
      blockedSummary: `Close window staged-index lock is already held by ${existing.taskId}; wait for release or inspect tasks status before staging.`
    };
  }

  const unexpectedStagedTasks = inspectForeignStagedTasksForCloseWindow({
    cwd: input.cwd,
    taskId: input.taskId,
    expectedStageFiles: input.expectedStageFiles
  });
  let foreignStagedSnapshotPath: string | null = null;
  if (unexpectedStagedTasks.length > 0 && !input.deferForeignStaged) {
    return {
      schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
      ok: false,
      lockPath: relativePathFrom(input.cwd, lockPath),
      lock: existing,
      unexpectedStagedTasks,
      foreignStagedSnapshotPath: null,
      blockedCode: 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS',
      blockedSummary: `Close window blocked by foreign staged tasks (${unexpectedStagedTasks.map((entry) => entry.taskId).join(', ')}); defer explicitly or wait for the other agent to commit.`
    };
  }
  if (unexpectedStagedTasks.length > 0 && input.deferForeignStaged) {
    foreignStagedSnapshotPath = deferForeignStagedFiles(input.cwd, unexpectedStagedTasks);
  }

  const record: CloseWindowStagedIndexLockRecord = {
    schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
    specVersion: '0.1.0',
    taskId: normalizeTaskId(input.taskId),
    actorId: input.actorId,
    acquiredAt: new Date().toISOString(),
    status: 'active',
    expectedStageFiles: uniqueSorted(input.expectedStageFiles),
    foreignStagedSnapshotPath,
    unexpectedStagedTasks,
    releasedAt: null,
    releaseOutcome: null
  };
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return {
    schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
    ok: true,
    lockPath: relativePathFrom(input.cwd, lockPath),
    lock: record,
    unexpectedStagedTasks,
    foreignStagedSnapshotPath,
    blockedCode: null,
    blockedSummary: null
  };
}

export function assertCloseWindowStagingAllowed(input: {
  cwd: string;
  taskId: string;
  operation: string;
}): void {
  const lock = readCloseWindowStagedIndexLock(input.cwd);
  if (!lock || lock.status !== 'active') return;
  if (lock.taskId === normalizeTaskId(input.taskId)) return;
  throw new CliError('ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED', `Close window staged-index lock held by ${lock.taskId} blocks ${input.operation}.`, {
    exitCode: 1,
    details: {
      lockTaskId: lock.taskId,
      operation: input.operation,
      lockPath: relativePathFrom(input.cwd, closeWindowStagedIndexLockPath(input.cwd)),
      requiredCommand: `node atm.mjs tasks status --task ${lock.taskId} --json`
    }
  });
}

export function releaseCloseWindowStagedIndexLock(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  outcome: CloseWindowStagedIndexLockOutcome;
}): CloseWindowStagedIndexLockRecord | null {
  const lockPath = closeWindowStagedIndexLockPath(input.cwd);
  const existing = readCloseWindowStagedIndexLock(input.cwd);
  if (!existing || existing.status !== 'active') return null;
  if (existing.taskId !== normalizeTaskId(input.taskId)) return existing;
  cleanupForeignStagedSnapshot(input.cwd, existing.foreignStagedSnapshotPath);
  const released: CloseWindowStagedIndexLockRecord = {
    ...existing,
    status: 'released',
    releasedAt: new Date().toISOString(),
    releaseOutcome: input.outcome
  };
  try {
    unlinkSync(lockPath);
  } catch {
    writeFileSync(lockPath, `${JSON.stringify(released, null, 2)}\n`, 'utf8');
  }
  return released;
}

export function readCloseWindowStagedIndexLockReport(cwd: string): CloseWindowStagedIndexLockRecord | null {
  return readCloseWindowStagedIndexLock(cwd);
}
