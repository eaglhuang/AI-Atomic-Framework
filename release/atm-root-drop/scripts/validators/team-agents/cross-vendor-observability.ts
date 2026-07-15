import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createBrokerConflictResolutionArtifact } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import {
  buildTeamObservabilityContract,
  createBrokerConflictObservabilityEvents,
  createTeamObservabilityEvent,
  queryTeamObservabilityEvents
} from '../../../packages/core/src/team-runtime/observability.ts';

export async function runCrossVendorObservabilityValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'cross-vendor-observability') return false;

  const schema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'governance', 'team-agent-observability-event.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const contract = buildTeamObservabilityContract();
  assert.equal(contract.schemaId, 'atm.teamAgentObservabilityContract.v1');
  assert.equal(contract.eventSchemaId, 'atm.teamAgentObservabilityEvent.v1');
  assert.ok(contract.eventTypes.includes('broker.conflict.blocked'));
  assert.ok(contract.eventTypes.includes('broker.conflict.resolution'));
  assert.deepEqual(contract.brokerConflictVocabulary, [
    'decisionClass',
    'decisionReason',
    'violationStatus',
    'broker-conflict-blocked'
  ]);
  assert.equal(contract.redactionPolicy.rawSecretsLogged, false);

  const artifact = createBrokerConflictResolutionArtifact({
    primaryTaskId: 'TASK-TEAM-0040',
    conflictingTaskIds: ['TASK-TEAM-0047'],
    sharedPaths: ['packages/cli/src/commands/team.ts'],
    decisionClass: 'serial-release',
    decisionReason: 'broker-conflict-blocked until observability records the release order.',
    violationStatus: 'broker-conflict-blocked',
    releaseOrder: ['TASK-TEAM-0040', 'TASK-TEAM-0047'],
    createdAt: '2026-07-10T00:00:00.000Z'
  });
  const genericEvent = createTeamObservabilityEvent({
    eventType: 'tool.invocation',
    taskId: 'TASK-TEAM-0040',
    teamRunId: 'team-observability-fixture',
    providerId: 'gemini',
    role: 'validator',
    runtimeMode: 'editor-subagent',
    artifactType: 'validator-report',
    artifactId: 'validator-report-1',
    summary: 'validator invoked shared observability gate',
    emittedAt: '2026-07-10T00:00:00.000Z'
  });
  const brokerEvents = createBrokerConflictObservabilityEvents({
    artifact,
    providerId: 'openai',
    role: 'coordinator',
    teamRunId: 'team-observability-fixture',
    emittedAt: '2026-07-10T00:00:00.000Z'
  });
  const events = [genericEvent, ...brokerEvents];
  for (const event of events) {
    assert.equal(validate(event), true, JSON.stringify(validate.errors));
    assert.equal(event.redaction.rawSecretsLogged, false);
    assert.equal(event.evidenceBoundary.rawSecretsAllowed, false);
  }
  assert.equal(brokerEvents[0].eventType, 'broker.conflict.blocked');
  assert.equal(brokerEvents[0].artifactType, 'atm.brokerConflictResolution.v1');
  assert.equal(brokerEvents[0].decisionClass, 'serial-release');
  assert.ok(brokerEvents[0].decisionReason?.includes('broker-conflict-blocked'));
  assert.equal(brokerEvents[0].violationStatus, 'broker-conflict-blocked');
  assert.equal(brokerEvents[0].statusCode, 'broker-conflict-blocked');

  const taskQuery = queryTeamObservabilityEvents(events, { taskId: 'TASK-TEAM-0040' });
  assert.equal(taskQuery.schemaId, 'atm.teamAgentObservabilityQueryResult.v1');
  assert.equal(taskQuery.eventCount, 3);
  const providerRoleQuery = queryTeamObservabilityEvents(events, {
    providerId: 'openai',
    role: 'coordinator',
    artifactType: 'atm.brokerConflictResolution.v1'
  });
  assert.equal(providerRoleQuery.eventCount, 2);
  assert.ok(providerRoleQuery.events.every((event) => event.providerId === 'openai'));
  assert.ok(providerRoleQuery.events.every((event) => event.role === 'coordinator'));

  const planResult = await runTeam(['plan', '--task', 'TASK-TEAM-0040', '--cwd', process.cwd(), '--json']);
  const planContract = (planResult.evidence as any)?.teamPlan?.observabilityContract;
  const findings = (planResult.evidence as any)?.teamPlan?.validation?.findings ?? [];
  const onlyBrokerAdmissionFinding = findings.length <= 1
    && findings.every((finding: any) => ['blocked-broker-cid-conflict', 'blocked-cid-conflict'].includes(finding?.code));
  const onlyTransientAdmissionFindings = findings.length <= 2
    && findings.every((finding: any) => ['blocked-broker-cid-conflict', 'blocked-cid-conflict', 'proposal-first-required'].includes(finding?.code));
  assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding || onlyTransientAdmissionFindings, true, 'plan may be blocked only by active broker/proposal admission while validating observability wiring');
  assert.equal(planContract?.schemaId, 'atm.teamAgentObservabilityContract.v1');
  assert.ok(planContract?.queryKeys?.includes('artifactType'));
  assert.ok(planContract?.brokerConflictVocabulary?.includes('broker-conflict-blocked'));

  const queryResult = await runTeam([
    'observability',
    'query',
    '--fixture',
    'broker-conflict-resolution',
    '--task',
    'TASK-TEAM-0040',
    '--conflict',
    'TASK-TEAM-0047',
    '--provider',
    'openai',
    '--role',
    'coordinator',
    '--artifact',
    'atm.brokerConflictResolution.v1',
    '--cwd',
    process.cwd(),
    '--json'
  ]);
  const queryEvidence = queryResult.evidence as any;
  assert.equal(queryResult.ok, true);
  assert.equal(queryEvidence?.action, 'observability.query');
  assert.equal(queryEvidence?.query?.eventCount, 2);
  assert.equal(queryEvidence?.query?.events?.[0]?.schemaId, 'atm.teamAgentObservabilityEvent.v1');
  assert.equal(queryEvidence?.query?.events?.[0]?.violationStatus, 'broker-conflict-blocked');

  const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
  assert.ok(vendorRuntimeDoc.includes('atm.teamAgentObservabilityEvent.v1'));
  assert.ok(vendorRuntimeDoc.includes('broker.conflict.blocked'));
  assert.ok(vendorRuntimeDoc.includes('rawSecretsLogged: false'));
  assert.ok(existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'observability.ts')));
  assert.ok(existsSync(path.join(process.cwd(), 'schemas', 'governance', 'team-agent-observability-event.schema.json')));
  assert.ok(existsSync(path.join(process.cwd(), 'scripts', 'validators', 'team-agents', 'cross-vendor-observability.ts')));

  console.log('[validate-team-agents] ok (cross-vendor-observability)');
  return true;
}
