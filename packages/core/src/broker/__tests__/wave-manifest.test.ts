import assert from 'node:assert/strict';
import { createTeamWaveEnvelope, type TeamWaveMemberEnvelope } from '../team-wave-envelope.ts';
import {
  createWaveManifest,
  evaluateWaveEligibility,
  fromTeamWaveEnvelope,
  transitionWaveManifest,
  validateWaveManifest,
  waveManifestSummary,
  type WaveManifestTask
} from '../wave-manifest.ts';

function task(overrides: Partial<WaveManifestTask> & { taskId: string }): WaveManifestTask {
  return {
    taskId: overrides.taskId,
    waveId: overrides.waveId ?? 'wave-1',
    targetRepo: overrides.targetRepo ?? 'AI-Atomic-Framework',
    surfaceFamily: overrides.surfaceFamily ?? 'broker-core',
    scopePaths: overrides.scopePaths ?? [`packages/core/src/${overrides.taskId}.ts`],
    validators: overrides.validators ?? ['npm run typecheck'],
    dependencyReady: overrides.dependencyReady ?? true,
    laneSessionId: overrides.laneSessionId ?? null,
    claimId: overrides.claimId ?? null
  };
}

function member(taskId: string): TeamWaveMemberEnvelope {
  return {
    taskId,
    workerActorId: `worker-${taskId}`,
    scopePaths: [`packages/core/src/${taskId}.ts`],
    deliverables: [`packages/core/src/${taskId}.ts`],
    patchEnvelopeId: `patch-${taskId}`,
    executionState: 'done'
  };
}

function testManifestLifecycleAndSummary() {
  const manifest = createWaveManifest({
    waveId: 'wave-1',
    batchRunId: 'batch-1',
    coordinatorActorId: 'captain',
    targetRepo: 'AI-Atomic-Framework',
    tasks: [task({ taskId: 'ATM-GOV-0172' })],
    now: '2026-07-18T00:00:00.000Z'
  });
  assert.equal(validateWaveManifest(manifest).ok, true);
  const admitted = transitionWaveManifest(manifest, 'admitted', '2026-07-18T00:01:00.000Z');
  assert.equal(admitted.state, 'admitted');
  assert.equal(waveManifestSummary(admitted).taskIds[0], 'ATM-GOV-0172');
  assert.throws(() => transitionWaveManifest(admitted, 'closed'), /invalid wave manifest transition/);
}

function testEligibilityRejectsMismatchedRepoAndSurface() {
  const decision = evaluateWaveEligibility([
    task({ taskId: 'A', targetRepo: 'repo-a' }),
    task({ taskId: 'B', targetRepo: 'repo-b', surfaceFamily: 'docs' })
  ]);
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.taskIds, ['A', 'B']);
  assert.match(decision.reasons.join('|'), /targetRepo/);
  assert.match(decision.reasons.join('|'), /surfaceFamily/);
}

function testEligibilityRejectsDependencyAndValidatorGaps() {
  const decision = evaluateWaveEligibility([
    task({ taskId: 'A', dependencyReady: false }),
    task({ taskId: 'B', validators: [] })
  ]);
  assert.equal(decision.ok, false);
  assert.match(decision.reasons.join('|'), /dependencies not ready: A/);
  assert.match(decision.reasons.join('|'), /validators missing: B/);
}

function testLegacyEnvelopeAdapter() {
  const legacy = createTeamWaveEnvelope({
    waveId: 'legacy-wave',
    coordinatorActorId: 'captain',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    waveIndex: 2,
    plannedAt: '2026-07-18T00:00:00.000Z',
    members: [member('A'), member('B')]
  });
  const manifest = fromTeamWaveEnvelope(legacy, {
    batchRunId: 'batch-legacy',
    validatorsByTask: { A: ['npm run typecheck'], B: ['npm run typecheck'] },
    surfaceFamilyByTask: { A: 'broker-core', B: 'broker-core' }
  });
  assert.equal(manifest.schemaId, 'atm.waveManifest.v1');
  assert.equal(manifest.executor, 'team-agents');
  assert.equal(validateWaveManifest(manifest).ok, true);
  assert.equal(evaluateWaveEligibility(manifest.tasks).ok, true);
}

testManifestLifecycleAndSummary();
testEligibilityRejectsMismatchedRepoAndSurface();
testEligibilityRejectsDependencyAndValidatorGaps();
testLegacyEnvelopeAdapter();

console.log('wave manifest tests: ok');
