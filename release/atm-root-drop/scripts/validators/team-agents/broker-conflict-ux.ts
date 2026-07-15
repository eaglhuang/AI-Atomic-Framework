import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { buildBrokerConflictUxProjection, runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runBrokerConflictUxValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'broker-conflict-ux') return false;

  const captainDecisionSchema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'team-agents', 'captain-decision.schema.json'), 'utf8'));
  const validateCaptainDecision = new Ajv2020({ allErrors: true }).compile(captainDecisionSchema);
  const commandResult = await runTeam([
    'broker',
    'resolve',
    '--task',
    'TASK-TEAM-0048-A',
    '--conflict',
    'TASK-TEAM-0048-B',
    '--path',
    'packages/cli/src/commands/team.ts',
    '--decision-reason',
    'broker-conflict-blocked by shared Team Broker UX surface; release sequentially.',
    '--created-at',
    '2026-07-10T00:00:00.000Z',
    '--cwd',
    process.cwd(),
    '--json'
  ]);
  const evidence = commandResult.evidence as any;
  const conflictUx = evidence?.conflictUx;
  assert.equal(commandResult.ok, true);
  assert.equal(conflictUx?.schemaId, 'atm.brokerConflictUx.v1');
  assert.equal(conflictUx?.playbookSlice, 'broker-conflict-resolution');
  assert.equal(conflictUx?.requiredResolutionArtifact, 'atm.brokerConflictResolution.v1');
  assert.deepEqual(conflictUx?.blockedTaskIds, ['TASK-TEAM-0048-B']);
  assert.deepEqual(conflictUx?.sharedPaths, ['packages/cli/src/commands/team.ts']);
  assert.equal(conflictUx?.decisionClass, 'serial-release');
  assert.ok(conflictUx?.decisionReason.includes('broker-conflict-blocked'));
  assert.equal(conflictUx?.violationStatus, 'broker-conflict-blocked');
  assert.ok(conflictUx?.nextSafeResolutionCommand.includes('team broker resolve'));
  assert.ok(conflictUx?.nextSafeResolutionCommand.includes('atm.brokerConflictResolution.v1') === false, 'command should produce the artifact, not pretend it is a flag');
  assert.ok(commandResult.messages?.some((entry: any) => entry?.data?.blockedTaskIds?.includes('TASK-TEAM-0048-B')));
  assert.ok(commandResult.messages?.some((entry: any) => entry?.data?.sharedPaths?.includes('packages/cli/src/commands/team.ts')));
  assert.ok(commandResult.messages?.some((entry: any) => entry?.data?.nextSafeResolutionCommand?.includes('team broker resolve')));

  const atomOnlyUx = buildBrokerConflictUxProjection({
    primaryTaskId: 'TASK-TEAM-0048-A',
    conflictingTaskIds: ['TASK-TEAM-0048-B'],
    overlappingAtomIds: ['atm.team-broker-conflict-resolution'],
    decisionClass: 'blocked',
    decisionReason: 'broker-conflict-blocked by atom overlap.',
    violationStatus: 'broker-conflict-blocked',
    statusCode: 'broker-conflict-blocked'
  });
  assert.deepEqual(atomOnlyUx.overlappingAtomIds, ['atm.team-broker-conflict-resolution']);
  assert.ok(atomOnlyUx.nextSafeResolutionCommand.includes('--path <shared-path>'));

  const captainDecisionFixture = {
    decision: 'block',
    optionsConsidered: ['continue', 'serialize via Broker'],
    chosenOption: 'serialize via Broker',
    reason: 'Broker conflict UX requires serial release.',
    risk: 'medium',
    lieutenantNeed: false,
    nextTeamShape: 'coordinator-only',
    advisoryOnly: true,
    decisionClass: conflictUx.decisionClass,
    decisionReason: conflictUx.decisionReason,
    violationStatus: conflictUx.violationStatus,
    statusCode: conflictUx.statusCode,
    requiredResolutionArtifact: conflictUx.requiredResolutionArtifact,
    playbookSlice: conflictUx.playbookSlice,
    blockedTaskIds: conflictUx.blockedTaskIds,
    sharedPaths: conflictUx.sharedPaths,
    sharedAtomIds: atomOnlyUx.overlappingAtomIds,
    nextSafeResolutionCommand: conflictUx.nextSafeResolutionCommand
  };
  assert.equal(validateCaptainDecision(captainDecisionFixture), true, JSON.stringify(validateCaptainDecision.errors));

  const roleRouting = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'role-routing-matrix.md'), 'utf8');
  assert.ok(roleRouting.includes('Captain conflict UX'));
  assert.ok(roleRouting.includes('nextSafeResolutionCommand'));
  assert.ok(roleRouting.includes('atm.brokerConflictResolution.v1'));
  assert.ok(roleRouting.includes('Manual edits to `.atm/runtime/**` are outside the'));

  const vendorRuntime = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
  assert.ok(vendorRuntime.includes('atm.brokerConflictUx.v1'));
  assert.ok(vendorRuntime.includes('decisionClass'));
  assert.ok(vendorRuntime.includes('team broker resolve'));

  assert.ok(existsSync(path.join(process.cwd(), 'schemas', 'team-agents', 'captain-decision.schema.json')));
  assert.ok(existsSync(path.join(process.cwd(), 'scripts', 'validators', 'team-agents', 'broker-conflict-ux.ts')));
  assert.ok(existsSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'team.ts')));

  console.log('[validate-team-agents] ok (broker-conflict-ux)');
  return true;
}
