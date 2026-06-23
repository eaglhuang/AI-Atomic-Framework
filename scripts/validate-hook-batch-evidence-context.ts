import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
mkdirSync(path.join(tempRoot, '.atm', 'runtime', 'batch-runs'), { recursive: true });

writeFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', 'TASK-X.json'), JSON.stringify({
  workItemId: 'TASK-X',
  status: 'ready',
  lastTransitionId: 'transition-1'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'task-events', 'TASK-X', 'transition-1.json'), JSON.stringify({
  schemaId: 'atm.taskTransition.v1',
  transitionId: 'transition-1',
  taskId: 'TASK-X',
  taskPath: '.atm/history/tasks/TASK-X.json',
  taskSha256: 'ignored-for-evidence-check',
  command: 'node atm.mjs tasks claim --task TASK-X --json'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'nested-runs', 'artifact.json'), JSON.stringify({
  scenario: 'nested artifact'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.bundle-manifest.json'), JSON.stringify({
  taskId: 'TASK-X',
  artifacts: ['.atm/history/evidence/nested-runs/artifact.json']
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.json'), JSON.stringify({
  taskId: 'TASK-X'
}, null, 2));
writeFileSync(path.join(tempRoot, '.atm', 'runtime', 'batch-runs', 'batch-demo.json'), JSON.stringify({
  schemaId: 'atm.batchRun.v1',
  batchId: 'batch-demo',
  status: 'active',
  taskIds: ['TASK-X']
}, null, 2));

const staged = [
  '.atm/history/tasks/TASK-X.json',
  '.atm/history/task-events/TASK-X/transition-1.json',
  '.atm/history/evidence/TASK-X.bundle-manifest.json',
  '.atm/history/evidence/TASK-X.json',
  '.atm/history/evidence/nested-runs/artifact.json',
  'docs/example.md'
];

const beforeEnv = process.env.ATM_BATCH_DELIVER_AND_CLOSE;
const withoutExemption = inspectProtectedAtmStateChanges(tempRoot, staged);
assert(
  withoutExemption.findings.some((finding) => finding.reason === 'batch-commit-before-checkpoint'),
  'normal staged batch deliverable should still require checkpoint before manual commit'
);
assert(
  !withoutExemption.findings.some((finding) => finding.file.endsWith('nested-runs/artifact.json') && finding.reason === 'evidence-file-missing-task-context'),
  'nested evidence artifact should inherit task context from sibling task/event/evidence'
);
assert(
  !withoutExemption.findings.some((finding) => finding.file.endsWith('TASK-X.bundle-manifest.json') && finding.reason === 'evidence-file-missing-task-context'),
  'bundle manifest must resolve to the owning task id instead of creating a synthetic staged task id'
);

process.env.ATM_BATCH_DELIVER_AND_CLOSE = '1';
const withExemption = inspectProtectedAtmStateChanges(tempRoot, staged);
assert(
  !withExemption.findings.some((finding) => finding.reason === 'batch-commit-before-checkpoint'),
  'deliver-and-close commit must bypass batch-commit-before-checkpoint hook finding'
);

if (beforeEnv == null) {
  delete process.env.ATM_BATCH_DELIVER_AND_CLOSE;
} else {
  process.env.ATM_BATCH_DELIVER_AND_CLOSE = beforeEnv;
}

console.log('[hook-batch-evidence-context] ok');
