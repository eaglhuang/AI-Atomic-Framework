import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { runAtmGit } from '../../../packages/cli/src/commands/git-governance.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const tempDir = path.resolve(root, '.atm-temp-test-git-commit-task-scoped-staging');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const branchCommitQueueSchema = JSON.parse(readFileSync(path.join(root, 'schemas', 'governance', 'branch-commit-queue.schema.json'), 'utf8'));
const validateBranchCommitQueue = ajv.compile(branchCommitQueueSchema);

export interface FixtureContext {
  taskId: string;
  foreignTaskId: string;
  foreignActiveTaskId: string;
  scopedFile: string;
  sessionId: string;
  leaseId: string;
  taskDocument: Record<string, unknown>;
}

export function assertBranchCommitQueueSchema(value: unknown, label: string) {
  assert.ok(validateBranchCommitQueue(value), `${label} must match branch commit queue schema: ${JSON.stringify(validateBranchCommitQueue.errors)}`);
}

export function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function expectCliError(promise: Promise<unknown>, code: string | readonly string[]) {
  const allowedCodes = Array.isArray(code) ? code : [code];
  return promise.then(
    () => {
      throw new Error(`expected ${allowedCodes.join(' or ')}`);
    },
    (error: unknown) => {
      const actualCode = (error as { code?: string }).code ?? '';
      assert.ok(allowedCodes.includes(actualCode), `expected ${allowedCodes.join(' or ')}, got ${actualCode}`);
      return error as { details?: Record<string, unknown> };
    }
  );
}

export async function createFixtureRepository(): Promise<FixtureContext> {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  runGit(tempDir, ['init']);
  runGit(tempDir, ['config', 'user.name', 'fixture-agent']);
  runGit(tempDir, ['config', 'user.email', 'fixture-agent@example.com']);

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
    updatedAt: '2026-06-11T00:00:00.000Z'
  });

  const taskId = 'TASK-GIT-STAGING-0141';
  const foreignTaskId = 'TASK-FOREIGN-0001';
  const foreignActiveTaskId = 'TASK-FOREIGN-ACTIVE-0002';
  const scopedFile = 'src/task-scoped-staging.ts';
  const sessionId = 'session-git-staging-0141';
  const leaseId = 'lease-git-staging-0141';
  const taskDocument = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'git commit task-scoped staging fixture',
    status: 'running',
    owner: 'fixture-agent',
    scopePaths: [scopedFile],
    deliverables: [scopedFile],
    claim: {
      actorId: 'fixture-agent',
      leaseId,
      state: 'active',
      files: [scopedFile]
    }
  };
  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskId}.json`), taskDocument);
  writeJson(path.join(tempDir, '.atm/runtime/sessions', `${sessionId}.json`), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId,
    actorId: 'fixture-agent',
    taskId,
    claimLeaseId: leaseId,
    status: 'active',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z'
  });

  mkdirSync(path.join(tempDir, path.dirname(scopedFile)), { recursive: true });
  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = true;\n', 'utf8');
  runGit(tempDir, ['add', '.atm']);
  runGit(tempDir, ['commit', '-m', 'chore: bootstrap staging fixture']);

  writeJson(path.join(tempDir, '.atm/runtime/locks/TASK-UNRELATED-LOCK.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: 'TASK-UNRELATED-LOCK',
    lockedBy: 'other-agent',
    actorId: 'other-agent',
    leaseId: 'lease-unrelated-lock',
    lockedAt: '2026-06-18T00:00:00.000Z',
    heartbeatAt: '2026-06-18T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: ['src/unrelated.ts'],
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-UNRELATED-LOCK',
      allowedFiles: ['src/unrelated.ts'],
      planningReadOnlyPaths: [],
      planningMirrorPaths: [],
      allowPlanningMirror: false,
      actorId: 'other-agent',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'active'
    }
  });

  runGit(tempDir, ['add', '.atm/runtime/locks/TASK-UNRELATED-LOCK.lock.json']);
  runGit(tempDir, ['commit', '-m', 'chore: add unrelated active direction lock fixture']);

  const importedTaskId = 'TASK-OPEN-0001';
  writeJson(path.join(tempDir, '.atm/history/tasks', `${importedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: importedTaskId,
    title: 'imported planned task fixture',
    status: 'planned',
    source: {
      planPath: 'docs/tasks/TASK-OPEN-0001.task.md',
      sectionTitle: importedTaskId,
      headingLine: 1,
      hash: 'imported-planned-task-fixture'
    }
  });
  writeJson(path.join(tempDir, '.atm/history/task-events', importedTaskId, '2026-06-18T00-00-00-000Z-import-fixture.json'), {
    schemaId: 'atm.taskTransition.v1',
    taskId: importedTaskId,
    transitionId: '2026-06-18T00-00-00-000Z-import-fixture',
    action: 'import',
    actorId: 'fixture-agent',
    createdAt: '2026-06-18T00:00:00.000Z',
    fromStatus: null,
    toStatus: 'planned',
    command: 'node atm.mjs tasks import --from docs/tasks/TASK-OPEN-0001.task.md --write --json'
  });
  runGit(tempDir, ['add', `.atm/history/tasks/${importedTaskId}.json`, `.atm/history/task-events/${importedTaskId}`]);
  const importCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', importedTaskId,
    '--message', 'chore(task): import planned task fixture',
    '--json'
  ]);
  assert.equal(importCommit.ok, true, 'ATM git wrapper must commit task import bundles without claiming the new planned task');
  assert.equal(typeof importCommit.evidence?.commitSha, 'string');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.serializedBy, 'branch-commit-queue');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.retryableRaceCode, 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.headShaAtCommitStart, (importCommit.evidence as any).branchCommitQueue?.headShaAtAcquire);
  assertBranchCommitQueueSchema((importCommit.evidence as any).branchCommitQueue, 'import commit branch queue evidence');
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes('.atm/history/evidence/git-head.jsonl'), true, 'task-scoped ledger-boundary commit must include git-head evidence in the same commit');

  return { taskId, foreignTaskId, foreignActiveTaskId, scopedFile, sessionId, leaseId, taskDocument };
}
