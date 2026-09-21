import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runTeam } from '../../packages/cli/src/commands/team.ts';

const repo = path.join(os.tmpdir(), `atm-team-broker-proposal-${process.pid}-${Date.now()}`);
const taskId = 'TASK-TEAM-PROPOSAL-CONSUMPTION';
const actorId = 'proposal-owner';
const targetFile = 'src/owned.ts';
const proposalFile = 'proposal.json';

function gitHead(cwd: string) {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sha256(filePath: string) {
  return `sha256:${crypto.createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function writeProposal(overrides: Record<string, unknown> = {}) {
  const absoluteTarget = path.join(repo, targetFile);
  writeFileSync(path.join(repo, proposalFile), `${JSON.stringify({
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test fixture' },
    proposalId: 'proposal.TASK-TEAM-PROPOSAL-CONSUMPTION.owner',
    taskId,
    actorId,
    baseCommit: gitHead(repo),
    fileBeforeHash: sha256(absoluteTarget),
    targetFile,
    atomRefs: [{ atomId: 'atom.test.proposal', atomCid: 'cid:atom.test.proposal' }],
    anchors: [{ kind: 'json-pointer', hint: '/fixture' }],
    intent: 'Exercise the bounded Team proposal admission path.',
    patch: '--- a/src/owned.ts\n+++ b/src/owned.ts\n',
    validators: ['node --version'],
    rollback: 'Restore src/owned.ts from the base commit.',
    ...overrides
  }, null, 2)}\n`, 'utf8');
}

try {
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, targetFile), 'export const owned = true;\n', 'utf8');
  spawnSync('git', ['-C', repo, 'init'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'add', '.'], { encoding: 'utf8' });
  const commit = spawnSync('git', ['-C', repo, '-c', 'user.name=ATM Test', '-c', 'user.email=atm-test@example.invalid', 'commit', '-m', 'fixture'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);

  writeFileSync(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Broker proposal consumption fixture',
    status: 'running',
    targetRepo: 'AI-Atomic-Framework',
    targetAllowedFiles: [targetFile],
    deliverables: [targetFile],
    proposalAdmission: { trigger: 'hot-file', summarySubmitted: false, hotFiles: [targetFile] }
  }, null, 2)}\n`, 'utf8');

  const blocked = await runTeam(['start', '--task', taskId, '--actor', actorId, '--cwd', repo, '--json']);
  assert.equal(blocked.ok, false, 'a proposal-first task must not start without a validated proposal');
  assert.ok(blocked.messages.some((entry) => entry.code === 'ATM_TEAM_START_BLOCKED'));
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'team-runs')), false);

  writeProposal({ actorId: 'different-owner' });
  await assert.rejects(
    () => runTeam(['start', '--task', taskId, '--actor', actorId, '--broker-proposal-file', proposalFile, '--cwd', repo, '--json']),
    (error: unknown) => (error as { code?: unknown }).code === 'ATM_TEAM_BROKER_PROPOSAL_INVALID'
  );
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'team-runs')), false);

  writeProposal();
  writeFileSync(path.join(repo, targetFile), 'export const owned = false;\n', 'utf8');
  await assert.rejects(
    () => runTeam(['start', '--task', taskId, '--actor', actorId, '--broker-proposal-file', proposalFile, '--cwd', repo, '--json']),
    (error: unknown) => (error as { code?: unknown }).code === 'ATM_TEAM_BROKER_PROPOSAL_INVALID'
  );
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'team-runs')), false);

  writeFileSync(path.join(repo, targetFile), 'export const owned = true;\n', 'utf8');
  writeProposal();
  const started = await runTeam([
    'start', '--task', taskId, '--actor', actorId, '--broker-proposal-file', proposalFile, '--cwd', repo, '--json'
  ]);
  assert.equal(started.ok, true, 'a matching current proposal must be consumed before the Team broker plans');
  assert.ok(started.messages.some((entry) => entry.code === 'ATM_TEAM_STARTED'));
  const brokerLane = (started.evidence as { brokerLane?: { decision?: { admission?: { summarySubmitted?: unknown; state?: unknown } } } }).brokerLane;
  assert.equal(brokerLane?.decision?.admission?.summarySubmitted, true);
  assert.notEqual(brokerLane?.decision?.admission?.state, 'proposal-submitted');
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'team-runs')), true);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[team-broker-proposal-consumption:test] ok');
