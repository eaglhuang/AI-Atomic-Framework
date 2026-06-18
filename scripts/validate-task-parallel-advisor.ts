import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const mockTasks = {
  'TASK-AAO-0130': {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-AAO-0130',
    title: 'Mock Task 130',
    status: 'ready',
    scopePaths: ['scripts/hello-world.js', 'packages/cli/src/atm.ts']
  },
  'TASK-AAO-0121': {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-AAO-0121',
    title: 'Mock Task 121',
    status: 'ready',
    scopePaths: ['packages/core/src/spec/index.ts']
  },
  'TASK-AAO-0005': {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-AAO-0005',
    title: 'Mock Task 005',
    status: 'ready',
    scopePaths: ['scripts/hello-world.js']
  },
  'TASK-AAO-0099': {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-AAO-0099',
    title: 'Mock Task 099',
    status: 'ready',
    scopePaths: ['packages/cli/src/commands/tasks.ts']
  }
};

const tasksDir = path.join(process.cwd(), '.atm', 'history', 'tasks');

// 寫入 Mock tasks 檔案
for (const [id, payload] of Object.entries(mockTasks)) {
  writeFileSync(path.join(tasksDir, `${id}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

function runJson(args: readonly string[]) {
  const output = execFileSync('node', ['atm.dev.mjs', ...args, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output) as { ok?: boolean; evidence?: Record<string, unknown> };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const pair = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--with', 'TASK-AAO-0121']);
  assert(pair.ok === true, 'tasks parallel pair analysis should succeed');
  assert(typeof pair.evidence?.finding === 'object' && pair.evidence.finding !== null, 'pair analysis should return finding evidence');
  assert(Array.isArray((pair.evidence?.task as { allowedFiles?: unknown } | undefined)?.allowedFiles) && ((pair.evidence?.task as { allowedFiles?: unknown[] } | undefined)?.allowedFiles?.length ?? 0) > 0, 'pair analysis should expose non-empty allowedFiles for the primary task');

  const overlapPair = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--with', 'TASK-AAO-0005']);
  assert(overlapPair.ok === true, 'tasks parallel overlap pair analysis should succeed');
  assert((overlapPair.evidence?.finding as { verdict?: unknown } | undefined)?.verdict === 'needs-physical-split', 'overlap pair should identify a physical split verdict');
  assert(
    Array.isArray((overlapPair.evidence?.finding as { overlappingFiles?: unknown } | undefined)?.overlappingFiles) &&
      ((overlapPair.evidence?.finding as { overlappingFiles?: unknown[] } | undefined)?.overlappingFiles?.includes('scripts/hello-world.js') ?? false),
    'overlap pair should report scripts/hello-world.js as an overlapping file'
  );

  const queue = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--queue']);
  assert(queue.ok === true, 'tasks parallel queue analysis should succeed');
  assert(Array.isArray(queue.evidence?.candidates), 'queue analysis should return candidates');
  const cidConflictCandidate = (queue.evidence?.candidates as Array<{ taskId?: unknown; finding?: { verdict?: unknown; overlappingAtomIds?: unknown; brokerAdmission?: { mutationIntentStatus?: unknown; confirmedConflict?: unknown } } }> | undefined)?.find(
    (candidate) => candidate.taskId === 'TASK-AAO-0099'
  );
  assert(Boolean(cidConflictCandidate), 'queue analysis should include TASK-AAO-0099');
  assert(cidConflictCandidate?.finding?.verdict === 'insufficient-mutation-intent', 'TASK-AAO-0099 should require Broker mutation intent instead of being classified as a confirmed CID conflict');
  assert(
    Array.isArray(cidConflictCandidate?.finding?.overlappingAtomIds) && cidConflictCandidate?.finding?.overlappingAtomIds.includes('atom-cli-router'),
    'TASK-AAO-0099 should report atom-cli-router as an overlapping atom id'
  );
  assert(cidConflictCandidate?.finding?.brokerAdmission?.confirmedConflict === false, 'TASK-AAO-0099 must not report a confirmed Broker conflict without mutation intent');
  assert(cidConflictCandidate?.finding?.brokerAdmission?.mutationIntentStatus === 'missing', 'TASK-AAO-0099 must explain the missing mutation intent');

  const report = runJson(['tasks', 'parallel', '--queue', '--report']);
  assert(report.ok === true, 'tasks parallel queue report should succeed');
  assert(typeof report.evidence?.hotspot === 'object' && report.evidence.hotspot !== null, 'queue report should return hotspot evidence');
  assert(
    Array.isArray((report.evidence?.hotspot as { topOverlappingFiles?: unknown } | undefined)?.topOverlappingFiles) &&
      ((report.evidence?.hotspot as { topOverlappingFiles?: Array<{ value?: unknown }> } | undefined)?.topOverlappingFiles?.some(
        (entry) => entry.value === 'scripts/hello-world.js'
      ) ?? false),
    'queue report should identify scripts/hello-world.js as an overlapping file hotspot'
  );

  console.log('validate-task-parallel-advisor: PASS');
} finally {
  // 清除 Mock tasks 檔案
  for (const id of Object.keys(mockTasks)) {
    try {
      unlinkSync(path.join(tasksDir, `${id}.json`));
    } catch {
      // ignore
    }
  }
}
