import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { evaluateBrokerQueueAdmission } from '../../packages/cli/src/commands/next/broker-queue-admission.ts';
import {
  createProposalLaneAdmission,
  isLiveSharedMutationPath,
  isProposalLanePrivatePath,
  readActiveProposalLane
} from '../../packages/cli/src/commands/next/proposal-lane.ts';
import { validateProposalLaneDurableRef } from '../../packages/cli/src/commands/broker/proposal-actions.ts';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');

async function testSharedOnlyNextClaimOpensIsolatedProposalLane() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-proposal-lane-'));
  try {
    initGitFixture(cwd);
    writeFixtureJson(cwd, '.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
    writeFixtureJson(cwd, '.atm/runtime/identity/default.json', { actorId: 'waiter-agent', gitName: 'ATM Fixture', gitEmail: 'fixture@example.invalid', updatedAt: '2026-07-20T00:00:00.000Z' });
    writeFixtureJson(cwd, '.atm/history/tasks/TASK-HEAD.json', taskDocument('TASK-HEAD', 'running', ['src/shared-only.ts'], 'head-agent'));
    writeFixtureJson(cwd, '.atm/history/tasks/TASK-WAITER.json', taskDocument('TASK-WAITER', 'ready', ['src/shared-only.ts'], null));
    mkdirSync(path.join(cwd, 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'src/shared-only.ts'), 'export const shared = true;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture base'], { cwd, stdio: 'ignore' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    writeFixtureJson(cwd, '.atm/runtime/broker-shared-surface-queues.json', {
      schemaId: 'atm.brokerSharedSurfaceQueues.v1',
      queues: [{
        schemaId: 'atm.brokerSharedSurfaceQueue.v1',
        surfacePath: 'src/shared-only.ts',
        entries: [
          { taskId: 'TASK-HEAD', actorId: 'head-agent', surfacePath: 'src/shared-only.ts', leaseEpoch: 1, baseHash: head, reason: 'owner', releaseCondition: 'owner release', queuedAt: '2026-07-20T00:00:00.000Z' },
          { taskId: 'TASK-WAITER', actorId: 'waiter-agent', surfacePath: 'src/shared-only.ts', leaseEpoch: 2, baseHash: head, reason: 'waiter', releaseCondition: 'proposal lane', queuedAt: '2026-07-20T00:01:00.000Z' }
        ]
      }]
    });

    const result = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-WAITER', '--actor', 'waiter-agent', '--claim-intent', 'write']) as any;
    assert.equal(result.ok, true, 'shared-only waiter should be admitted into an isolated proposal lane');
    assert.equal(result.evidence.nextAction.teamRecommendation.parallelAdvisory.proposalLaneAdmission.status, 'proposal-lane-opened');
    const directionLockFiles = result.evidence.nextAction.taskDirectionLock.allowedFiles as string[];
    assert.equal(directionLockFiles.includes('src/shared-only.ts'), false);
    assert.ok(directionLockFiles.length > 0, 'proposal lane claim should still have runtime proposal/evidence paths');
    assert.ok(directionLockFiles.every(isProposalLanePrivatePath), JSON.stringify(directionLockFiles));
    assert.ok(directionLockFiles.every((entry) => !isLiveSharedMutationPath(entry)), JSON.stringify(directionLockFiles));
    const lane = readActiveProposalLane(cwd, 'TASK-WAITER');
    assert.equal(lane?.candidateSharedSurfaces.includes('src/shared-only.ts'), true);
    validateLaneSchema(lane);
    console.log('ok: shared-only next claim opens isolated proposal lane without live shared writes');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function testPureProposalLaneAdmission() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-proposal-lane-pure-'));
  try {
    const queueAdmission = evaluateBrokerQueueAdmission({
      cwd,
      taskId: 'TASK-B',
      allowedFiles: ['packages/core/src/shared.ts'],
      overlappingFiles: ['packages/core/src/shared.ts']
    });
    const blockedAdmission = {
      ...queueAdmission,
      status: 'queued-blocked' as const,
      queuedSharedPaths: ['packages/core/src/shared.ts'],
      waitingOn: [{ surfacePath: 'packages/core/src/shared.ts', queueHeadTaskId: 'TASK-A', position: 2 }],
      allowedFiles: []
    };
    const admission = createProposalLaneAdmission({
      cwd,
      taskId: 'TASK-B',
      actorId: 'actor-b',
      baseDigest: 'base',
      overlappingFiles: ['packages/core/src/shared.ts'],
      queueAdmission: blockedAdmission,
      now: new Date('2026-07-20T00:00:00.000Z')
    });
    assert.equal(admission.status, 'proposal-lane-opened');
    assert.ok(admission.proposalLane);
    assert.equal(admission.proposalLane.candidateSharedSurfaces.includes('packages/core/src/shared.ts'), true);
    assert.ok(admission.allowedPrivatePaths.every(isProposalLanePrivatePath));
    assert.ok(admission.allowedPrivatePaths.every((entry) => !isLiveSharedMutationPath(entry)));
    assert.equal(validateProposalLaneDurableRef(admission.proposalLane.durableProposalRef).ok, true);
    assert.equal(validateProposalLaneDurableRef('packages/core/src/shared.ts').ok, false);

    const second = createProposalLaneAdmission({
      cwd,
      taskId: 'TASK-B',
      actorId: 'actor-b',
      baseDigest: 'base',
      overlappingFiles: ['packages/core/src/shared.ts'],
      queueAdmission: blockedAdmission,
      existingLane: admission.proposalLane,
      now: new Date('2026-07-20T00:01:00.000Z')
    });
    assert.equal(second.status, 'same-task-conflict');
    console.log('ok: proposal lane helper isolates runtime paths and preserves same-task conflict');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function validateLaneSchema(value: unknown) {
  const schema = JSON.parse(readFileSync(path.resolve('schemas/governance/proposal-lane.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
}

function initGitFixture(cwd: string) {
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd, stdio: 'ignore' });
}

function taskDocument(taskId: string, status: string, scopePaths: readonly string[], activeClaimActorId: string | null) {
  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: taskId,
    status,
    scopePaths,
    deliverables: scopePaths,
    targetAllowedFiles: scopePaths,
    targetRepo: 'fixture',
    closureAuthority: 'target_repo',
    source: { planPath: null },
    ...(activeClaimActorId ? { activeClaimActorId, activeClaimIntent: 'write' } : {})
  };
}

function writeFixtureJson(cwd: string, relativePath: string, value: unknown) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

await testSharedOnlyNextClaimOpensIsolatedProposalLane();
testPureProposalLaneAdmission();
