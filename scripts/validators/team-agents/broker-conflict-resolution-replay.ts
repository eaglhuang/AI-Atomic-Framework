import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runBrokerConflictResolutionReplayFixture } from '../../validate-mao-event-replay.ts';

export function runBrokerConflictResolutionReplayValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'broker-conflict-resolution-replay') return false;

  const replay = runBrokerConflictResolutionReplayFixture(process.cwd());
  assert.equal(replay.ok, true);
  assert.equal(replay.artifactType, 'atm.brokerConflictResolution.v1');
  assert.equal(replay.finalState, 'green');
  assert.equal(replay.initialGates.length, 4);
  assert.ok(replay.initialGates.every((gate) => gate.statusCode === 'broker-conflict-blocked'));
  assert.ok(replay.initialGates.every((gate) => gate.violationStatus === 'broker-conflict-blocked'));
  assert.equal(replay.firstAdmission.ok, true);
  assert.equal(replay.prematureSecondAdmission.ok, false);
  assert.equal(replay.secondAdmissionAfterFirstRelease.ok, true);
  assert.equal(replay.resolvedAdmission.statusCode, 'resolved');
  assert.deepEqual([...replay.sharedVocabulary].sort(), [
    'broker-conflict-blocked',
    'decisionClass',
    'decisionReason',
    'violationStatus'
  ]);

  assert.equal(existsSync(path.join(process.cwd(), 'scripts', 'fixtures', 'mao-event-replay', 'broker-conflict-resolution.fixture.json')), true);

  console.log('[validate-team-agents] ok (broker-conflict-resolution-replay)');
  return true;
}
