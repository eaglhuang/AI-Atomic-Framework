import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAutoEvidencePlan,
  executeAutoEvidencePlan
} from '../../packages/cli/src/commands/evidence.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-taskflow-auto-evidence');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  runGit(tempDir, ['init']);
  runGit(tempDir, ['config', 'user.name', 'fixture-agent']);
  runGit(tempDir, ['config', 'user.email', 'fixture-agent@example.com']);
  writeFileSync(path.join(tempDir, 'README.md'), '# auto-evidence fixture\n', 'utf8');
  runGit(tempDir, ['add', 'README.md']);
  runGit(tempDir, ['commit', '-m', 'init']);

  writeJson(path.join(tempDir, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson(path.join(tempDir, '.atm/runtime/identity/default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'fixture-agent',
    gitName: 'fixture-agent',
    gitEmail: 'fixture-agent@example.com',
    updatedAt: '2026-06-18T00:00:00.000Z'
  });

  const passTaskId = 'TASK-AUTO-EVIDENCE-PASS';
  writeJson(path.join(tempDir, '.atm/history/tasks', `${passTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: passTaskId,
    title: 'auto evidence pass fixture',
    status: 'running',
    owner: 'fixture-agent',
    validators: ['git diff --check']
  });
  writeJson(path.join(tempDir, '.atm/history/evidence', `${passTaskId}.json`), {
    taskId: passTaskId,
    updatedAt: '2026-06-18T00:00:00.000Z',
    evidence: []
  });

  const passPlan = buildAutoEvidencePlan({
    cwd: tempDir,
    taskId: passTaskId,
    actorId: 'fixture-agent'
  });
  assert.equal(passPlan.schemaId, 'atm.autoEvidencePlan.v1');
  assert.equal(passPlan.ok, false);
  assert.ok(passPlan.toRun.some((entry) => entry.validator === 'git diff --check'));
  assert.ok(passPlan.toRun[0]?.requiredCommand?.includes('evidence run'));
  assert.ok(!passPlan.toRun[0]?.requiredCommand?.includes('git add .'));

  const passExecution = executeAutoEvidencePlan({
    cwd: tempDir,
    taskId: passTaskId,
    actorId: 'fixture-agent'
  });
  assert.equal(passExecution.ok, true, JSON.stringify(passExecution, null, 2));
  assert.ok(passExecution.runs.some((run) => run.validator === 'git diff --check' && run.ok));
  const evidenceAfterPass = JSON.parse(readFileSync(path.join(tempDir, '.atm/history/evidence', `${passTaskId}.json`), 'utf8'));
  assert.ok(
    evidenceAfterPass.evidence.some((record: { details?: { validationPasses?: string[] } }) =>
      Array.isArray(record.details?.validationPasses)
      && record.details.validationPasses.includes('git diff --check')
    ),
    'auto-evidence must record command-backed validation pass evidence'
  );

  const failTaskId = 'TASK-AUTO-EVIDENCE-FAIL';
  const failingCommand = 'node -e "process.exit(1)"';
  writeJson(path.join(tempDir, '.atm/history/tasks', `${failTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: failTaskId,
    title: 'auto evidence fail fixture',
    status: 'running',
    owner: 'fixture-agent',
    validators: [failingCommand]
  });
  writeJson(path.join(tempDir, '.atm/history/evidence', `${failTaskId}.json`), {
    taskId: failTaskId,
    updatedAt: '2026-06-18T00:00:00.000Z',
    evidence: []
  });

  const failExecution = executeAutoEvidencePlan({
    cwd: tempDir,
    taskId: failTaskId,
    actorId: 'fixture-agent'
  });
  assert.equal(failExecution.ok, false);
  assert.equal(failExecution.failedValidator, failingCommand);
  assert.ok(failExecution.remediationCommand?.includes('evidence run'));
  const evidenceAfterFail = JSON.parse(readFileSync(path.join(tempDir, '.atm/history/evidence', `${failTaskId}.json`), 'utf8'));
  assert.equal(evidenceAfterFail.evidence.length, 0, 'failed validator runs must not create pass evidence');

  const approvalPlan = buildAutoEvidencePlan({
    cwd: tempDir,
    taskId: passTaskId,
    actorId: 'fixture-agent'
  });
  assert.equal(approvalPlan.ok, true);
  assert.equal(approvalPlan.toRun.length, 0);
} finally {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log('[taskflow-auto-evidence] ok');
