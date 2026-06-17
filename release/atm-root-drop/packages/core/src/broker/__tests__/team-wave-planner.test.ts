// TASK-MAO-0024: tests for the Team Agents Wave Mode candidate planner.
import assert from 'node:assert/strict';
import {
  planWaves,
  pairBlockReasons,
  type WaveCandidateCard
} from '../team-wave-planner.ts';

function card(over: Partial<WaveCandidateCard> & { taskId: string }): WaveCandidateCard {
  return {
    taskId: over.taskId,
    dependencies: over.dependencies ?? [],
    scopePaths: over.scopePaths ?? [`src/${over.taskId}.ts`],
    deliverables: over.deliverables ?? [`src/${over.taskId}.ts`],
    validators: over.validators ?? ['npm run typecheck'],
    targetRepo: over.targetRepo ?? 'repo-x',
    closureAuthority: over.closureAuthority ?? 'target_repo',
    ownerAtomOrMap: over.ownerAtomOrMap ?? null
  };
}

function testDisjointCardsShareOneWave() {
  const plan = planWaves({ cards: [card({ taskId: 'T-A' }), card({ taskId: 'T-B' })] });
  assert.equal(plan.waves.length, 1);
  assert.equal(plan.waves[0].members.length, 2);
  assert.equal(plan.unschedulable.length, 0);
}

function testSameDeliverableSplitsAsWriteWrite() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', scopePaths: ['src/shared.ts'], deliverables: ['src/shared.ts'] }),
    card({ taskId: 'T-B', scopePaths: ['src/shared.ts'], deliverables: ['src/shared.ts'] }),
    new Set()
  );
  assert.ok(reasons.includes('same-atom-write-write'));
}

function testUnknownScopeOverlapFailsClosed() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', scopePaths: ['src/dir/'], deliverables: ['src/dir/a.ts'] }),
    card({ taskId: 'T-B', scopePaths: ['src/dir/b.ts'], deliverables: ['src/dir/b.ts'] }),
    new Set()
  );
  assert.ok(reasons.includes('scope-overlap-unknown-range'));
}

function testClosureAuthorityMismatchBlocks() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', closureAuthority: 'target_repo' }),
    card({ taskId: 'T-B', closureAuthority: 'planning_repo' }),
    new Set()
  );
  assert.ok(reasons.includes('closure-authority-mismatch'));
}

function testTargetRepoMismatchBlocks() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', targetRepo: 'repo-x' }),
    card({ taskId: 'T-B', targetRepo: 'repo-y' }),
    new Set()
  );
  assert.ok(reasons.includes('target-repo-mismatch'));
}

function testGeneratedArtifactContentionBlocks() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', ownerAtomOrMap: 'atm.shared-map' }),
    card({ taskId: 'T-B', ownerAtomOrMap: 'atm.shared-map' }),
    new Set()
  );
  assert.ok(reasons.includes('generated-artifact-contention'));
}

function testMissingValidatorIsUnschedulable() {
  const plan = planWaves({ cards: [card({ taskId: 'T-A', validators: [] })] });
  assert.equal(plan.waves.length, 0);
  assert.equal(plan.unschedulable[0].taskId, 'T-A');
  assert.ok(plan.unschedulable[0].reasons.includes('missing-validator'));
}

function testDependencyOrdersIntoLaterWave() {
  const plan = planWaves({
    cards: [
      card({ taskId: 'T-A' }),
      card({ taskId: 'T-B', dependencies: ['T-A'] })
    ]
  });
  // T-B depends on T-A, so they cannot share a wave: two sequential waves.
  assert.equal(plan.waves.length, 2);
  assert.equal(plan.waves[0].members[0].taskId, 'T-A');
  assert.equal(plan.waves[1].members[0].taskId, 'T-B');
}

function testAppendSafeOverlapDoesNotBlock() {
  const reasons = pairBlockReasons(
    card({ taskId: 'T-A', scopePaths: ['map.json', 'src/a.ts'], deliverables: ['src/a.ts'] }),
    card({ taskId: 'T-B', scopePaths: ['map.json', 'src/b.ts'], deliverables: ['src/b.ts'] }),
    new Set(['map.json'])
  );
  assert.deepEqual(reasons, []);
}

function testUnresolvedExternalDependencyIsUnschedulable() {
  const plan = planWaves({ cards: [card({ taskId: 'T-A', dependencies: ['T-MISSING'] })] });
  assert.equal(plan.waves.length, 0);
  assert.ok(plan.unschedulable.some((u) => u.taskId === 'T-A'));
}

testDisjointCardsShareOneWave();
testSameDeliverableSplitsAsWriteWrite();
testUnknownScopeOverlapFailsClosed();
testClosureAuthorityMismatchBlocks();
testTargetRepoMismatchBlocks();
testGeneratedArtifactContentionBlocks();
testMissingValidatorIsUnschedulable();
testDependencyOrdersIntoLaterWave();
testAppendSafeOverlapDoesNotBlock();
testUnresolvedExternalDependencyIsUnschedulable();

console.log('team wave planner tests: ok');
