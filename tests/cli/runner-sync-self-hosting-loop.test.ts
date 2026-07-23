import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerSyncReceipt,
  type SealedBuildTimings
} from '../../scripts/run-sealed-runner-build.ts';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import type { RunnerSyncAdmissionReport } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-loop-'));
const root = process.cwd();
const atmCliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');

try {
  initRepo(repo);
  const actorId = 'codex.gpt/5:mini';
  const sourceSha = 'a'.repeat(40);
  const report = inspectRunnerSyncAdmission({
    cwd: repo,
    stewardActorId: actorId,
    sealedSourceSha: sourceSha,
    dirtyFiles: [],
    foreignClaims: []
  });
  assert.equal(report.ok, false);
  assert.match(report.requiredCommand ?? '', /framework-mode claim/);
  assert.match(report.requiredCommand ?? '', /broker runner-sync enqueue/);
  assert.match(report.requiredCommand ?? '', /ATM-FRAMEWORK-TEMP-codex-gpt-5-mini/);
  assert.doesNotMatch(report.requiredCommand ?? '', /ATM-FRAMEWORK-TEMP-codex\.gpt\/5:mini/);

  const executable = toFixtureCommand(report.requiredCommand ?? '', repo);
  const enqueue = spawnSync(executable, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    enqueue.status,
    0,
    `emitted runner-sync command must be executable\ncommand: ${executable}\nstdout:\n${enqueue.stdout}\nstderr:\n${enqueue.stderr}`
  );
  const queue = JSON.parse(readFileSync(path.join(repo, '.atm/runtime/runner-sync-steward-queue.json'), 'utf8'));
  assert.deepEqual(queue.groups[0].waitingTasks, ['ATM-FRAMEWORK-TEMP-codex-gpt-5-mini']);
  assert.equal(queue.groups[0].requests[0].actorId, actorId);

  const receipt = buildRunnerSyncReceipt({
    admission: makeAdmission(queue.groups[0].stewardWorkId),
    actorId,
    actorIdentitySource: 'ATM_ACTOR_ID',
    sealedSourceSha: sourceSha,
    buildTarget: 'full',
    buildInputsTreeHash: `sha256:${'b'.repeat(64)}`,
    buildDecision: 'cacheHitSkip',
    timings: timings(),
    publishedAt: '2026-07-20T00:00:00.000Z'
  });
  assert.deepEqual(receipt.actorIdentity, { actorId, source: 'ATM_ACTOR_ID' });
  assert.equal(receipt.atomicWrite.strategy, 'temp-file-rename-with-retry');
  assert.equal(receipt.atomicWrite.maxAttempts, 4);
  assert.match(receipt.autoReleaseCommand, /broker runner-sync release/);
  assert.match(receipt.autoReleaseCommand, /--receipt-ref ".atm\/history\/evidence\/ATM-FRAMEWORK-TEMP-codex-gpt-5-mini.runner-sync-receipt.json"/);

  console.log('[runner-sync-self-hosting-loop.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function initRepo(cwd: string): void {
  mkdirSync(path.join(cwd, 'release/atm-onefile'), { recursive: true });
  mkdirSync(path.join(cwd, 'release/atm-root-drop'), { recursive: true });
  writeFileSync(path.join(cwd, 'README.md'), '# fixture\n', 'utf8');
  runGit(cwd, ['init']);
  runGit(cwd, ['config', 'user.name', 'fixture']);
  runGit(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(cwd, ['add', 'README.md']);
  runGit(cwd, ['commit', '-m', 'fixture']);
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stderr}`);
}

function toFixtureCommand(command: string, cwd: string): string {
  const cli = `${JSON.stringify(process.execPath)} --strip-types ${JSON.stringify(atmCliEntrypoint)}`;
  return command
    .replace('node atm.mjs framework-mode', `${cli} framework-mode --cwd ${JSON.stringify(cwd)}`)
    .replace('node atm.mjs broker', `${cli} broker --cwd ${JSON.stringify(cwd)}`);
}

function timings(): SealedBuildTimings {
  return {
    startedAt: Date.now(),
    inputHashCalculationMs: 1,
    skipDecisionMs: 1,
    worktreeSetupMs: 0,
    typescriptBuildMs: 0,
    rootDropAssemblyMs: 0,
    onefileAssemblyMs: 0,
    artifactSyncMs: 1,
    cleanupMs: 0,
    totalElapsedMs: 3
  };
}

function makeAdmission(stewardWorkId: string): RunnerSyncAdmissionReport {
  return {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: true,
    stewardActorId: 'codex.gpt/5:mini',
    sealedSourceSha: 'a'.repeat(40),
    runnerSyncSteward: {
      stewardWorkId,
      queuePosition: 1,
      suggestedNextAction: 'release with receipt',
      waitingTasks: ['ATM-FRAMEWORK-TEMP-codex-gpt-5-mini'],
      requestedSurfaces: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop'],
      requests: [{
        taskId: 'ATM-FRAMEWORK-TEMP-codex-gpt-5-mini',
        actorId: 'codex.gpt/5:mini',
        requestedSurfaces: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop']
      }]
    },
    queueHeadOwnership: {
      ok: true,
      stewardWorkId,
      queuePosition: 1,
      queueHeadHealth: 'task-active',
      waitingTasks: ['ATM-FRAMEWORK-TEMP-codex-gpt-5-mini'],
      ownerActorIds: ['codex.gpt/5:mini'],
      reason: null,
      cleanupCommand: null
    },
    foreignNonReleaseWip: [],
    foreignBuildInputConflicts: [],
    releaseWip: [],
    ordinaryTaskReleaseAutoStageAllowed: false,
    brokerTicket: null,
    requiredCommand: null,
    actorAuthority: {
      schemaId: 'atm.sharedWriteActorAuthority.v1',
      ok: true,
      actorId: 'codex.gpt/5:mini',
      resolutionSource: 'option',
      legacyEnvActorId: null,
      legacyEnvDisagrees: false,
      laneSessionId: null,
      queueHeadOwnerActorIds: ['codex.gpt/5:mini'],
      activeClaimOwnerActorId: 'codex.gpt/5:mini',
      recoveryCommand: null,
      reason: null
    }
  };
}
