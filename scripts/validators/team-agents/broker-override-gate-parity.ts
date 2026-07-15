import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildBrokerConflictSharedVocabulary } from '../../../packages/cli/src/commands/team.ts';
import { evaluateClaimAdmission } from '../../../packages/cli/src/commands/next/claim-admission.ts';
import { evaluateTaskflowBrokerConflictGate } from '../../../packages/cli/src/commands/taskflow/broker-gate.ts';
import { createTempWorkspace } from '../../temp-root.ts';

export async function runBrokerOverrideGateParityValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'broker-override-gate-parity') return false;

  const claimAdmission = evaluateClaimAdmission({
    brokerVerdict: 'freeze',
    cidVerdict: 'insufficient-mutation-intent',
    candidateTaskId: 'TASK-TEAM-0047',
    conflictingTaskId: 'TASK-RFT-0005',
    overlappingAtomIds: ['atm.team-broker-enforcement']
  });
  assert.equal(claimAdmission.admitted, false);
  assert.equal(claimAdmission.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
  assert.ok(claimAdmission.blockReason?.includes('broker-conflict-blocked'));

  const cwd = createTempWorkspace('team-broker-gate-parity-');
  const now = Date.now();
  const heartbeatAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  mkdirSync(path.join(cwd, '.atm', 'runtime'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'write-broker.registry.json'), `${JSON.stringify({
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'fixture-repo',
    workspaceId: 'main',
    activeIntents: [
      {
        intentId: 'intent-TASK-TEAM-0047',
        taskId: 'TASK-TEAM-0047',
        teamRunId: null,
        actorId: 'captain',
        baseCommit: 'base-fixture',
        resourceKeys: {
          files: ['src/shared.ts'],
          atomIds: [],
          atomCids: [],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: now,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt,
        lane: 'direct-brokered',
        expiresAt
      },
      {
        intentId: 'intent-TASK-RFT-0005',
        taskId: 'TASK-RFT-0005',
        teamRunId: null,
        actorId: 'cursor',
        baseCommit: 'base-fixture',
        resourceKeys: {
          files: ['src/shared.ts'],
          atomIds: [],
          atomCids: [],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: now,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt,
        lane: 'direct-brokered',
        expiresAt
      }
    ]
  }, null, 2)}\n`, 'utf8');
  const taskflowGate = evaluateTaskflowBrokerConflictGate({
    cwd,
    taskId: 'TASK-TEAM-0047',
    declaredFiles: ['src/shared.ts'],
    actorId: 'captain'
  });
  assert.equal(taskflowGate.verdict, 'insufficientMutationIntent');
  assert.equal(taskflowGate.decisionClass, 'blocked');
  assert.equal(taskflowGate.violationStatus, 'broker-conflict-blocked');
  assert.equal(taskflowGate.statusCode, 'broker-conflict-blocked');
  assert.ok(taskflowGate.requiredCommand?.includes('team broker resolve'));
  assert.ok(taskflowGate.requiredCommand?.includes('broker-conflict-blocked'));

  const sharedVocabulary = buildBrokerConflictSharedVocabulary({
    safeToStart: false,
    blockedReasons: ['Proposal-first lane is active; broker recorded a provisional write lease before final admission.']
  } as any);
  assert.equal(sharedVocabulary?.decisionClass, 'blocked');
  assert.ok(sharedVocabulary?.decisionReason.includes('broker-conflict-blocked'));
  assert.equal(sharedVocabulary?.violationStatus, 'broker-conflict-blocked');

  const gitGovernanceSource = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'git-governance.ts'), 'utf8');
  assert.ok(gitGovernanceSource.includes("'decisionClass'"));
  assert.ok(gitGovernanceSource.includes("'decisionReason'"));
  assert.ok(gitGovernanceSource.includes("'violationStatus'"));
  assert.ok(gitGovernanceSource.includes('ATM_GIT_COMMIT_BROKER_CONFLICT_OVERRIDE_REQUIRED'));

  console.log('[validate-team-agents] ok (broker-override-gate-parity)');
  return true;
}
