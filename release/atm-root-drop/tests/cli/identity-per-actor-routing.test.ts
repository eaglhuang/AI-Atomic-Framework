import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const atmEntrypoint = path.join(root, 'packages/cli/src/atm.ts');
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-identity-routing-'));

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  });
}

function runAtm(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return execFileSync(process.execPath, ['--strip-types', atmEntrypoint, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

try {
  runGit(tempDir, ['init']);
  runGit(tempDir, ['config', 'user.name', 'host-user']);
  runGit(tempDir, ['config', 'user.email', 'host-user@example.com']);

  writeJson(path.join(tempDir, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });

  runAtm(tempDir, ['actor', 'register', '--id', 'actor-a', '--kind', 'ai-agent', '--name', 'Actor A', '--git-name', 'Actor A', '--git-email', 'actor-a@example.com', '--json']);
  runAtm(tempDir, ['actor', 'register', '--id', 'actor-b', '--kind', 'ai-agent', '--name', 'Actor B', '--git-name', 'Actor B', '--git-email', 'actor-b@example.com', '--json']);

  const taskA = 'TASK-MAO-0053-A';
  const taskB = 'TASK-MAO-0053-B';
  const leaseA = 'lease-actor-a';
  const leaseB = 'lease-actor-b';
  const sessionA = 'session-actor-a';
  const sessionB = 'session-actor-b';
  const fileA = 'src/actor-a.ts';
  const fileB = 'src/actor-b.ts';

  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskA}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskA,
    title: 'actor a commit fixture',
    status: 'running',
    owner: 'actor-a',
    scopePaths: [fileA],
    deliverables: [fileA],
    claim: { actorId: 'actor-a', leaseId: leaseA, state: 'active', files: [fileA] }
  });
  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskB}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskB,
    title: 'actor b commit fixture',
    status: 'running',
    owner: 'actor-b',
    scopePaths: [fileB],
    deliverables: [fileB],
    claim: { actorId: 'actor-b', leaseId: leaseB, state: 'active', files: [fileB] }
  });
  writeJson(path.join(tempDir, '.atm/runtime/sessions', `${sessionA}.json`), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId: sessionA,
    actorId: 'actor-a',
    taskId: taskA,
    claimLeaseId: leaseA,
    status: 'active',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z'
  });
  writeJson(path.join(tempDir, '.atm/runtime/sessions', `${sessionB}.json`), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId: sessionB,
    actorId: 'actor-b',
    taskId: taskB,
    claimLeaseId: leaseB,
    status: 'active',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z'
  });

  mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  writeFileSync(path.join(tempDir, fileA), 'export const actorA = "A";\n', 'utf8');
  writeFileSync(path.join(tempDir, fileB), 'export const actorB = "B";\n', 'utf8');

  runGit(tempDir, ['add', '.atm', 'src']);
  runGit(tempDir, ['commit', '-m', 'chore: bootstrap actor routing fixture']);

  writeFileSync(path.join(tempDir, fileA), 'export const actorA = "A1";\n', 'utf8');
  writeFileSync(path.join(tempDir, fileB), 'export const actorB = "B1";\n', 'utf8');

  runAtm(tempDir, ['identity', 'set', '--actor', 'actor-a', '--git-name', 'Actor A', '--git-email', 'actor-a@example.com', '--json']);
  runAtm(tempDir, ['identity', 'set', '--actor', 'actor-b', '--git-name', 'Actor B', '--git-email', 'actor-b@example.com', '--json']);

  const actorAIdentity = readJson(path.join(tempDir, '.atm/runtime/identity/actors/actor-a.json'));
  const actorBIdentity = readJson(path.join(tempDir, '.atm/runtime/identity/actors/actor-b.json'));
  assert.equal(actorAIdentity.actorId, 'actor-a');
  assert.equal(actorBIdentity.actorId, 'actor-b');

  runGit(tempDir, ['config', 'user.name', 'drifted-host']);
  runGit(tempDir, ['config', 'user.email', 'drifted-host@example.com']);

  runAtm(tempDir, ['git', 'commit', '--cwd', tempDir, '--actor', 'actor-a', '--task', taskA, '--session', sessionA, '--message', 'feat: actor a lane', '--auto-stage', '--json']);
  const actorACommitSha = runGit(tempDir, ['rev-parse', 'HEAD']).trim();
  const actorAAuthor = runGit(tempDir, ['show', '-s', '--format=%an <%ae>', actorACommitSha]).trim();
  assert.equal(actorAAuthor, 'Actor A <actor-a@example.com>');

  runGit(tempDir, ['config', 'user.name', 'drifted-host-b']);
  runGit(tempDir, ['config', 'user.email', 'drifted-host-b@example.com']);

  runAtm(tempDir, ['git', 'commit', '--cwd', tempDir, '--actor', 'actor-b', '--task', taskB, '--session', sessionB, '--message', 'feat: actor b lane', '--auto-stage', '--json']);
  const actorBCommitSha = runGit(tempDir, ['rev-parse', 'HEAD']).trim();
  const actorBAuthor = runGit(tempDir, ['show', '-s', '--format=%an <%ae>', actorBCommitSha]).trim();
  assert.equal(actorBAuthor, 'Actor B <actor-b@example.com>');

  const defaultIdentityPath = path.join(tempDir, '.atm/runtime/identity/default.json');
  if (existsSync(defaultIdentityPath)) {
    assert.equal(readFileSync(defaultIdentityPath, 'utf8').includes('actor-b@example.com'), false, 'per-actor identity writes must not overwrite default.json');
  }

  console.log('identity-per-actor-routing: ok');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
