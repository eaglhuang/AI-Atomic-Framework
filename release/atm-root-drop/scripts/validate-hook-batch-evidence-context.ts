import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { inspectProtectedAtmStateChanges } from '../packages/cli/src/commands/hook.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`[hook-batch-evidence-context] FAIL ${message}`);
    process.exit(1);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-batch-evidence-'));
mkdirSync(path.join(tempRoot, '.atm', 'history', 'tasks'), { recursive: true });
mkdirSync(path.join(tempRoot, '.atm', 'history', 'task-events', 'TASK-X'), { recursive: true });
mkdirSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'nested-runs'), { recursive: true });

const stagedTaskDocument = JSON.stringify({
  workItemId: 'TASK-X',
  status: 'ready',
  lastTransitionId: 'transition-1'
}, null, 2);
writeFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', 'TASK-X.json'), stagedTaskDocument);
writeFileSync(path.join(tempRoot, '.atm', 'history', 'task-events', 'TASK-X', 'transition-1.json'), JSON.stringify({
  schemaId: 'atm.taskTransition.v1',
  transitionId: 'transition-1',
  taskId: 'TASK-X',
  taskPath: '.atm/history/tasks/TASK-X.json',
  taskSha256: createHash('sha256').update(stagedTaskDocument).digest('hex'),
  command: 'node atm.mjs tasks claim --task TASK-X --json'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'nested-runs', 'artifact.json'), JSON.stringify({
  taskId: 'TASK-X',
  scenario: 'nested artifact'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.bundle-manifest.json'), JSON.stringify({
  taskId: 'TASK-X',
  artifacts: ['.atm/history/evidence/nested-runs/artifact.json']
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.json'), JSON.stringify({
  taskId: 'TASK-X'
}, null, 2));
const staged = [
  '.atm/history/tasks/TASK-X.json',
  '.atm/history/task-events/TASK-X/transition-1.json',
  '.atm/history/evidence/TASK-X.bundle-manifest.json',
  '.atm/history/evidence/TASK-X.json',
  '.atm/history/evidence/nested-runs/artifact.json'
];

const withoutExemption = inspectProtectedAtmStateChanges(tempRoot, staged);
assert(
  !withoutExemption.findings.some((finding) => finding.file.endsWith('nested-runs/artifact.json') && finding.reason === 'evidence-file-missing-task-context'),
  'nested evidence artifact should inherit task context from sibling task/event/evidence'
);
assert(
  !withoutExemption.findings.some((finding) => finding.file.endsWith('TASK-X.bundle-manifest.json') && finding.reason === 'evidence-file-missing-task-context'),
  'bundle manifest must resolve to the owning task id instead of creating a synthetic staged task id'
);

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert(result.status === 0, `git ${args.join(' ')} must succeed: ${result.stderr}`);
}

function writeCommittedLedger(root: string, taskId: string, workItemId = taskId) {
  const taskPath = path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId,
    status: 'running'
  }, null, 2));
}

function writeTaskEvidence(root: string, taskId: string) {
  const evidencePath = path.join(root, '.atm', 'history', 'evidence', `${taskId}.json`);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify({ taskId }, null, 2));
  return `.atm/history/evidence/${taskId}.json`;
}

const committedContextRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-committed-context-'));
writeCommittedLedger(committedContextRoot, 'TASK-COMMITTED');
writeCommittedLedger(committedContextRoot, 'TASK-MISMATCH', 'TASK-OTHER');
writeCommittedLedger(committedContextRoot, 'TASK-SECOND');
runGit(committedContextRoot, ['init']);
runGit(committedContextRoot, ['config', 'user.email', 'atm-test@example.invalid']);
runGit(committedContextRoot, ['config', 'user.name', 'ATM Test']);
runGit(committedContextRoot, ['add', '.atm/history/tasks']);
runGit(committedContextRoot, ['commit', '-m', 'seed committed task contexts']);

const committedEvidence = writeTaskEvidence(committedContextRoot, 'TASK-COMMITTED');
const committedContextResult = inspectProtectedAtmStateChanges(committedContextRoot, [committedEvidence]);
assert(
  !committedContextResult.findings.some((finding) => finding.reason === 'evidence-file-missing-task-context'),
  'evidence-only closeback must accept one semantic task id proven by an exact committed ledger'
);

const mismatchEvidence = writeTaskEvidence(committedContextRoot, 'TASK-MISMATCH');
const mismatchResult = inspectProtectedAtmStateChanges(committedContextRoot, [mismatchEvidence]);
assert(
  mismatchResult.findings.some((finding) => finding.reason === 'evidence-file-missing-task-context'),
  'evidence-only closeback must reject a committed ledger whose workItemId differs from the evidence task id'
);

const absentEvidence = writeTaskEvidence(committedContextRoot, 'TASK-ABSENT');
const absentResult = inspectProtectedAtmStateChanges(committedContextRoot, [absentEvidence]);
assert(
  absentResult.findings.some((finding) => finding.reason === 'evidence-file-missing-task-context'),
  'evidence-only closeback must reject a task id with no committed ledger context'
);

const secondEvidence = writeTaskEvidence(committedContextRoot, 'TASK-SECOND');
const multiTaskResult = inspectProtectedAtmStateChanges(committedContextRoot, [committedEvidence, secondEvidence]);
assert(
  multiTaskResult.findings.some((finding) => finding.reason === 'evidence-file-missing-task-context'),
  'evidence-only closeback must reject multiple semantic task identities even when each has committed context'
);

console.log('[hook-batch-evidence-context] ok');
