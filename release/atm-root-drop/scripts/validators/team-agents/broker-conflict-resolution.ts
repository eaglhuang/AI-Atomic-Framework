import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { TEAM_ATOM_BOUNDARIES, runTeam } from '../../../packages/cli/src/commands/team.ts';
import {
  advanceBrokerConflictResolution,
  createBrokerConflictResolutionArtifact,
  decideBrokerConflictResolutionAdmission
} from '../../../packages/core/src/team-runtime/permission-broker.ts';

export async function runBrokerConflictResolutionValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'broker-conflict-resolution') return false;

  const schema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'governance', 'broker-conflict-resolution.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const fixture = createBrokerConflictResolutionArtifact({
    primaryTaskId: 'TASK-TEAM-0046-A',
    conflictingTaskIds: ['TASK-TEAM-0046-B'],
    sharedPaths: ['packages/core/src/team-runtime/permission-broker.ts'],
    decisionClass: 'serial-release',
    decisionReason: 'broker-conflict-blocked until the release order grants the next task.',
    createdAt: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(fixture.schemaId, 'atm.brokerConflictResolution.v1');
  assert.equal(fixture.decisionClass, 'serial-release');
  assert.ok(fixture.decisionReason.includes('broker-conflict-blocked'));
  assert.equal(fixture.violationStatus, 'broker-conflict-blocked');
  assert.equal(fixture.statusCode, 'broker-conflict-blocked');
  assert.deepEqual(fixture.releaseOrder, ['TASK-TEAM-0046-A', 'TASK-TEAM-0046-B']);
  assert.equal(fixture.currentAllowedTaskId, 'TASK-TEAM-0046-A');
  assert.deepEqual(fixture.blockedTaskIds, ['TASK-TEAM-0046-B']);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));

  const firstAdmission = decideBrokerConflictResolutionAdmission(fixture, 'TASK-TEAM-0046-A');
  const blockedAdmission = decideBrokerConflictResolutionAdmission(fixture, 'TASK-TEAM-0046-B');
  assert.equal(firstAdmission.ok, true);
  assert.equal(firstAdmission.statusCode, 'broker-conflict-blocked');
  assert.equal(blockedAdmission.ok, false);
  assert.equal(blockedAdmission.violationStatus, 'broker-conflict-blocked');
  assert.equal(blockedAdmission.statusCode, 'broker-conflict-blocked');

  const advanced = advanceBrokerConflictResolution(fixture, 'TASK-TEAM-0046-A');
  assert.equal(advanced.currentAllowedTaskId, 'TASK-TEAM-0046-B');
  assert.equal(decideBrokerConflictResolutionAdmission(advanced, 'TASK-TEAM-0046-B').ok, true);
  const resolved = advanceBrokerConflictResolution(advanced, 'TASK-TEAM-0046-B');
  assert.equal(resolved.violationStatus, 'resolved');
  assert.equal(resolved.currentAllowedTaskId, null);
  assert.equal(decideBrokerConflictResolutionAdmission(resolved, 'TASK-TEAM-0046-A').statusCode, 'resolved');

  const runtimeDir = path.join(process.cwd(), '.atm', 'runtime', 'broker-conflict-resolutions');
  const before = snapshotRuntimeArtifacts(runtimeDir);
  try {
    const commandResult = await runTeam([
      'broker',
      'resolve',
      '--task',
      'TASK-TEAM-0046-A',
      '--conflict',
      'TASK-TEAM-0046-B',
      '--path',
      'packages/core/src/team-runtime/permission-broker.ts',
      '--decision-reason',
      'broker-conflict-blocked by atom overlap; release sequentially.',
      '--created-at',
      '2026-07-10T00:00:00.000Z',
      '--cwd',
      process.cwd(),
      '--json'
    ]);
    const artifact = (commandResult.evidence as any)?.artifact;
    assert.equal(commandResult.ok, true);
    assert.equal(artifact?.schemaId, 'atm.brokerConflictResolution.v1');
    assert.equal(artifact?.decisionClass, 'serial-release');
    assert.equal(artifact?.violationStatus, 'broker-conflict-blocked');
    assert.equal(artifact?.statusCode, 'broker-conflict-blocked');
    assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
    assert.equal((commandResult.evidence as any)?.sharedVocabulary?.decisionClass, 'serial-release');
    assert.equal((commandResult.evidence as any)?.sharedVocabulary?.violationStatus, 'broker-conflict-blocked');
    assert.ok(TEAM_ATOM_BOUNDARIES['team.broker-conflict-resolution'].capability.includes('decisionClass'));
  } finally {
    cleanupRuntimeArtifacts(runtimeDir, before);
  }

  console.log('[validate-team-agents] ok (broker-conflict-resolution)');
  return true;
}

function snapshotRuntimeArtifacts(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).map((entry) => path.join(dir, entry)));
}

function cleanupRuntimeArtifacts(dir: string, before: Set<string>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (!before.has(fullPath)) rmSync(fullPath, { force: true });
  }
}
