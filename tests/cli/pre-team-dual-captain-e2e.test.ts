import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-pre-team-dual-captain-'));

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function write(relativePath: string, content: string): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function writeJson(relativePath: string, value: unknown): void {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function stagedBlobIdentity(relativePath: string): string {
  const line = git(['ls-files', '-s', '--', relativePath]).trim();
  const match = /^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/i.exec(line);
  assert.ok(match, `expected staged blob identity for ${relativePath}`);
  return `${match[1]}:${match[2]}:${match[3]}`;
}

try {
  git(['init']);
  git(['config', 'user.name', 'fixture-captain-a']);
  git(['config', 'user.email', 'fixture-captain-a@example.com']);

  const taskId = 'ATM-GOV-0145';
  const actorId = 'fixture-captain-a';
  const sessionId = 'session-atm-gov-0145';
  const leaseId = 'lease-atm-gov-0145';
  const activeDeliverable = 'src/active-close-deliverable.ts';
  const foreignStaged = 'src/foreign-captain-staged.ts';
  const foreignUnstaged = 'src/foreign-captain-unstaged.ts';

  writeJson('.atm/config.json', {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson('.atm/runtime/identity/default.json', {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId,
    gitName: 'fixture-captain-a',
    gitEmail: 'fixture-captain-a@example.com',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'dual captain foundation gate fixture',
    status: 'running',
    owner: actorId,
    scopePaths: [activeDeliverable],
    deliverables: [activeDeliverable],
    claim: {
      actorId,
      leaseId,
      state: 'active',
      files: [activeDeliverable]
    }
  });
  writeJson(`.atm/runtime/sessions/${sessionId}.json`, {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId,
    actorId,
    taskId,
    claimLeaseId: leaseId,
    status: 'active',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  write(activeDeliverable, 'export const activeCloseDeliverable = "base";\n');
  write(foreignStaged, 'export const foreignCaptainStaged = "base";\n');
  write(foreignUnstaged, 'export const foreignCaptainUnstaged = "base";\n');
  git(['add', '.']);
  git(['commit', '-m', 'chore: seed dual captain fixture']);

  write(activeDeliverable, 'export const activeCloseDeliverable = "ready";\n');
  write(foreignStaged, 'export const foreignCaptainStaged = "approved-stage";\n');
  git(['add', foreignStaged]);
  const foreignStagedBefore = stagedBlobIdentity(foreignStaged);
  write(foreignUnstaged, 'export const foreignCaptainUnstaged = "worktree-only";\n');
  const foreignUnstagedBefore = readFileSync(path.join(repo, foreignUnstaged), 'utf8');

  const result = await runAtmGit([
    'commit',
    '--cwd', repo,
    '--actor', actorId,
    '--task', taskId,
    '--session', sessionId,
    '--message', 'test: dual captain scoped commit',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);

  assert.equal(result.ok, true, 'governed commit must succeed while foreign work exists');
  const headFiles = git(['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(headFiles.includes(activeDeliverable), true, 'active task deliverable must be committed');
  assert.equal(headFiles.includes(foreignStaged), false, 'foreign staged file must not enter the active task commit');
  assert.equal(headFiles.includes(foreignUnstaged), false, 'foreign unstaged file must not enter the active task commit');
  assert.equal(stagedBlobIdentity(foreignStaged), foreignStagedBefore, 'foreign staged blob must remain byte-identical');
  assert.equal(readFileSync(path.join(repo, foreignUnstaged), 'utf8'), foreignUnstagedBefore, 'foreign unstaged content must remain byte-identical');
  assert.equal(git(['diff', '--cached', '--name-only']).includes(foreignStaged), true, 'foreign staged file must remain staged for its owner');
  assert.equal(git(['diff', '--name-only']).includes(foreignUnstaged), true, 'foreign unstaged file must remain dirty for its owner');

  console.log('[pre-team-dual-captain-e2e] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
