import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createBrokerConflictResolutionArtifact } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import {
  createBrokerConflictObservabilityEvents,
  createTeamObservabilityEvent
} from '../../../packages/core/src/team-runtime/observability.ts';

export async function runRealObservabilityQueryValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'real-observability-query') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-real-observability');
  const teamRunId = 'team-real-observability-fixture';
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs', teamRunId), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
    schemaId: 'atm.teamRun.v1',
    teamRunId,
    taskId: 'TASK-TEAM-0058',
    status: 'active',
    observabilityEvents: []
  }, null, 2)}\n`, 'utf8');
  const providerEvent = createTeamObservabilityEvent({
    eventType: 'artifact.output',
    taskId: 'TASK-TEAM-0058',
    teamRunId,
    providerId: 'openai',
    role: 'implementer',
    runtimeMode: 'real-agent',
    artifactType: 'atm.teamProviderRunArtifact.v1',
    artifactId: 'provider-run-1',
    summary: 'provider run artifact emitted',
    emittedAt: '2026-07-10T01:00:00.000Z'
  });
  const conflictArtifact = createBrokerConflictResolutionArtifact({
    primaryTaskId: 'TASK-TEAM-0058',
    conflictingTaskIds: ['TASK-TEAM-0047'],
    sharedPaths: ['packages/cli/src/commands/team.ts'],
    decisionClass: 'serial-release',
    decisionReason: 'broker-conflict-blocked runtime event query fixture.',
    violationStatus: 'broker-conflict-blocked',
    releaseOrder: ['TASK-TEAM-0058', 'TASK-TEAM-0047'],
    createdAt: '2026-07-10T01:00:00.000Z'
  });
  const conflictEvents = createBrokerConflictObservabilityEvents({
    artifact: conflictArtifact,
    providerId: 'openai',
    role: 'validator',
    teamRunId,
    emittedAt: '2026-07-10T01:00:00.000Z'
  });
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', teamRunId, 'observability-events.jsonl'), [
    providerEvent,
    ...conflictEvents
  ].map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

  try {
    const providerQuery = await runTeam([
      'observability',
      'query',
      '--cwd',
      cwd,
      '--team-run',
      teamRunId,
      '--provider',
      'openai',
      '--role',
      'implementer',
      '--artifact',
      'atm.teamProviderRunArtifact.v1',
      '--json'
    ]);
    const providerEvidence = providerQuery.evidence as any;
    assert.equal(providerQuery.ok, true);
    assert.equal(providerEvidence?.eventSource, 'runtime');
    assert.equal(providerEvidence?.query?.eventCount, 1);
    assert.equal(providerEvidence?.query?.events?.[0]?.artifactType, 'atm.teamProviderRunArtifact.v1');

    const conflictQuery = await runTeam([
      'observability',
      'query',
      '--cwd',
      cwd,
      '--team-run',
      teamRunId,
      '--event-type',
      'broker.conflict.blocked',
      '--json'
    ]);
    const conflictEvidence = conflictQuery.evidence as any;
    assert.equal(conflictQuery.ok, true);
    assert.equal(conflictEvidence?.query?.eventCount, 1);
    assert.equal(conflictEvidence?.query?.events?.[0]?.violationStatus, 'broker-conflict-blocked');
    assert.equal(conflictEvidence?.query?.events?.[0]?.redaction?.rawSecretsLogged, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (real-observability-query)');
  return true;
}
