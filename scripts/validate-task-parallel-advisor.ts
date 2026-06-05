import { execFileSync } from 'node:child_process';

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

const pair = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--with', 'TASK-AAO-0121']);
assert(pair.ok === true, 'tasks parallel pair analysis should succeed');
assert(typeof pair.evidence?.finding === 'object' && pair.evidence.finding !== null, 'pair analysis should return finding evidence');
assert(Array.isArray((pair.evidence?.task as { allowedFiles?: unknown } | undefined)?.allowedFiles) && ((pair.evidence?.task as { allowedFiles?: unknown[] } | undefined)?.allowedFiles?.length ?? 0) > 0, 'pair analysis should expose non-empty allowedFiles for the primary task');

const overlapPair = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--with', 'TASK-AAO-0005']);
assert(overlapPair.ok === true, 'tasks parallel overlap pair analysis should succeed');
assert((overlapPair.evidence?.finding as { verdict?: unknown } | undefined)?.verdict === 'needs-physical-split', 'overlap pair should identify a physical split verdict');
assert(
  Array.isArray((overlapPair.evidence?.finding as { overlappingFiles?: unknown } | undefined)?.overlappingFiles) &&
    ((overlapPair.evidence?.finding as { overlappingFiles?: unknown[] } | undefined)?.overlappingFiles?.includes('packages/cli/src/commands/tasks.ts') ?? false),
  'overlap pair should report tasks.ts as an overlapping file'
);

const queue = runJson(['tasks', 'parallel', '--task', 'TASK-AAO-0130', '--queue']);
assert(queue.ok === true, 'tasks parallel queue analysis should succeed');
assert(Array.isArray(queue.evidence?.candidates), 'queue analysis should return candidates');
const cidConflictCandidate = (queue.evidence?.candidates as Array<{ taskId?: unknown; finding?: { verdict?: unknown; overlappingAtomIds?: unknown } }> | undefined)?.find(
  (candidate) => candidate.taskId === 'TASK-AAO-0099'
);
assert(Boolean(cidConflictCandidate), 'queue analysis should include TASK-AAO-0099');
assert(cidConflictCandidate?.finding?.verdict === 'blocked-cid-conflict', 'TASK-AAO-0099 should be classified as a CID conflict');
assert(
  Array.isArray(cidConflictCandidate?.finding?.overlappingAtomIds) && cidConflictCandidate?.finding?.overlappingAtomIds.includes('atom-cli-router'),
  'TASK-AAO-0099 should report atom-cli-router as an overlapping atom id'
);

const report = runJson(['tasks', 'parallel', '--queue', '--report']);
assert(report.ok === true, 'tasks parallel queue report should succeed');
assert(typeof report.evidence?.hotspot === 'object' && report.evidence.hotspot !== null, 'queue report should return hotspot evidence');
assert(
  Array.isArray((report.evidence?.hotspot as { topOverlappingFiles?: unknown } | undefined)?.topOverlappingFiles) &&
    ((report.evidence?.hotspot as { topOverlappingFiles?: Array<{ value?: unknown }> } | undefined)?.topOverlappingFiles?.[0]?.value ===
      'atomic_workbench/atomization-coverage/path-to-atom-map.json'),
  'queue report should identify path-to-atom-map.json as the top overlapping file hotspot'
);

console.log('validate-task-parallel-advisor: PASS');
