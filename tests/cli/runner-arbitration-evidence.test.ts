import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeMissingValidatorReport } from '../../packages/cli/src/commands/evidence.ts';
import { resolveTaskRunnerArbitration } from '../../packages/cli/src/commands/validate.ts';

const tempRoot = path.join(os.tmpdir(), `atm-runner-arbitration-${Date.now()}`);

try {
  testSourceFirstArbitration();
  testFrozenRunnerArbitrationWithForeignLock();
} finally {
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('[runner-arbitration-evidence] ok');

function testSourceFirstArbitration() {
  const cwd = path.join(tempRoot, 'source-first');
  bootstrapRepo(cwd);
  writeTaskDocument(cwd, 'TASK-SOURCE-FIRST', ['src/owned.ts']);
  writeEvidenceBundle(cwd, 'TASK-SOURCE-FIRST');
  writeTrackedFile(cwd, 'src/owned.ts', 'export const owned = 1;\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'baseline']);
  writeTrackedFile(cwd, 'src/owned.ts', 'export const owned = 2;\n');

  const arbitration = resolveTaskRunnerArbitration(cwd, 'TASK-SOURCE-FIRST');
  assert.equal(arbitration.preferredRunnerKind, 'dev-source');
  assert.deepEqual(arbitration.sourceFirstFiles, ['src/owned.ts']);
  assert.deepEqual(arbitration.foreignActiveFiles, []);

  const report = computeMissingValidatorReport(cwd, 'TASK-SOURCE-FIRST', 'fixture-agent');
  const finding = report.blockingFindings.find((entry) => entry.validator === 'typecheck');
  assert.ok(finding, 'expected missing typecheck finding');
  assert.match(String(finding?.requiredCommand ?? ''), /--runner-kind dev-source/);
}

function testFrozenRunnerArbitrationWithForeignLock() {
  const cwd = path.join(tempRoot, 'frozen-runner');
  bootstrapRepo(cwd);
  writeTaskDocument(cwd, 'TASK-FROZEN', ['src/shared.ts']);
  writeEvidenceBundle(cwd, 'TASK-FROZEN');
  writeTrackedFile(cwd, 'src/shared.ts', 'export const shared = 1;\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'baseline']);
  writeTrackedFile(cwd, 'src/shared.ts', 'export const shared = 2;\n');
  writeForeignDirectionLock(cwd, 'TASK-FOREIGN', ['src/shared.ts']);

  const arbitration = resolveTaskRunnerArbitration(cwd, 'TASK-FROZEN');
  assert.equal(arbitration.preferredRunnerKind, 'frozen-runner');
  assert.deepEqual(arbitration.sourceFirstFiles, []);
  assert.deepEqual(arbitration.foreignActiveFiles, ['src/shared.ts']);
  assert.deepEqual(arbitration.frozenFiles, ['src/shared.ts']);

  const report = computeMissingValidatorReport(cwd, 'TASK-FROZEN', 'fixture-agent');
  const finding = report.blockingFindings.find((entry) => entry.validator === 'typecheck');
  assert.ok(finding, 'expected missing typecheck finding');
  assert.match(String(finding?.requiredCommand ?? ''), /--runner-kind frozen-runner/);
}

function bootstrapRepo(cwd: string) {
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(cwd, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(cwd, '.atm', 'runtime', 'locks'), { recursive: true });
  mkdirSync(path.join(cwd, 'src'), { recursive: true });
  git(cwd, ['init']);
  git(cwd, ['config', 'user.name', 'fixture-agent']);
  git(cwd, ['config', 'user.email', 'fixture-agent@example.com']);
}

function writeTaskDocument(cwd: string, taskId: string, deliverables: readonly string[]) {
  writeJson(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: taskId,
    status: 'running',
    owner: 'fixture-agent',
    deliverables,
    scopePaths: deliverables,
    validators: ['npm run typecheck']
  });
}

function writeEvidenceBundle(cwd: string, taskId: string) {
  writeJson(path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`), {
    taskId,
    updatedAt: '2026-06-20T00:00:00.000Z',
    evidence: []
  });
}

function writeForeignDirectionLock(cwd: string, taskId: string, allowedFiles: readonly string[]) {
  writeJson(path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), {
    files: allowedFiles,
    status: 'active',
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      specVersion: '0.1.0',
      taskId,
      batchId: null,
      scopeKey: null,
      queueId: null,
      queueIndex: null,
      allowedFiles,
      planningReadOnlyPaths: [],
      planningMirrorPaths: [],
      allowPlanningMirror: false,
      promptHash: null,
      actorId: 'foreign-agent',
      createdAt: '2026-06-20T00:00:00.000Z',
      status: 'active'
    }
  });
}

function writeTrackedFile(cwd: string, relativePath: string, content: string) {
  const targetPath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
}

function writeJson(targetPath: string, value: unknown) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
