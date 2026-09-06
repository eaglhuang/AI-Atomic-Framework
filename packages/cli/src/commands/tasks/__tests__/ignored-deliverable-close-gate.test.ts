import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateTaskDeliverableGate } from '../close-helpers/close-artifact-staging.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-ignored-deliverable-'));
const taskId = 'TASK-TMP-0024';
const ignoredArtifact = 'artifacts/generated-close-report.json';
const taskPath = path.join(cwd, '.atm', 'history', 'tasks');

mkdirSync(path.join(cwd, '.atm', 'history'), { recursive: true });
mkdirSync(taskPath, { recursive: true });
mkdirSync(path.join(cwd, 'artifacts'), { recursive: true });
writeFileSync(path.join(cwd, '.gitignore'), 'artifacts/\n');
writeFileSync(path.join(cwd, 'tracked.txt'), 'base\n');
writeFileSync(path.join(cwd, ignoredArtifact), '{"ok":true}\n');
writeFileSync(path.join(cwd, 'unrelated.log'), 'ignore me\n');
writeFileSync(path.join(taskPath, `${taskId}.json`), JSON.stringify({
  deliverables: [ignoredArtifact],
  scopePaths: [ignoredArtifact],
  source: { planPath: 'temporary-governance/temporary-governance-plan.md' }
}));
execFileSync('git', ['init', '-q'], { cwd });
execFileSync('git', ['config', 'user.email', 'atm-test@example.invalid'], { cwd });
execFileSync('git', ['config', 'user.name', 'ATM test'], { cwd });
execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd });
execFileSync('git', ['commit', '-qm', 'base'], { cwd });

const report = evaluateTaskDeliverableGate({
  cwd,
  taskId,
  taskDocument: {
    deliverables: [ignoredArtifact],
    scopePaths: [ignoredArtifact],
    source: { planPath: 'temporary-governance/temporary-governance-plan.md' }
  },
  taskDeclaredFiles: [ignoredArtifact],
  claim: null
});

assert(report.ok, 'declared ignored artifact should satisfy the deliverable gate');
assert(report.deliverableFiles.includes(ignoredArtifact), 'declared ignored artifact should be reported');
assert(!report.changedFiles.includes('unrelated.log'), 'unrelated ignored files must remain excluded');
console.log('[ignored-deliverable-close-gate] ok');
