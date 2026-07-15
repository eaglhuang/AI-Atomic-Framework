import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { validateClosurePacket } from '../../../packages/cli/src/commands/framework-development.ts';
import { verifyTaskEvidence } from '../../../packages/cli/src/commands/evidence.ts';
import { buildTeamClosureAttestation, buildTeamRuntimeContract } from '../../../packages/cli/src/commands/team.ts';

export async function runSandboxAttestationValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'sandbox-attestation') return false;

    const runtime = buildTeamRuntimeContract({
      runtimeMode: 'real-agent',
      runtimeLanguage: 'node',
      providerId: 'local',
      sdkId: 'nodejs-reference',
      modelId: 'fixture-model'
    });
    const satisfiedAttestation = buildTeamClosureAttestation({
      teamRunId: 'team-sandbox-attestation-fixture',
      runtimeContract: runtime,
      runtimeVersion: 'node-fixture-runtime',
      attestationSigner: 'coordinator',
      reviewerIndependence: {
        required: true,
        satisfied: true,
        reviewerProviderId: 'local-review',
        reviewerModelId: 'review-fixture-model',
        reviewerRuntimeAdapterId: 'atm.node.reference-worker',
        reason: 'reviewer used a separate model fixture'
      },
      attestedAt: '2026-06-18T00:00:00.000Z'
    });
    const unsatisfiedAttestation = buildTeamClosureAttestation({
      teamRunId: 'team-sandbox-attestation-fixture-unsatisfied',
      runtimeContract: runtime,
      reviewerIndependence: {
        required: true,
        satisfied: false,
        reason: 'reviewer independence policy was not satisfied'
      },
      attestedAt: '2026-06-18T00:00:00.000Z'
    });
    assert.equal(satisfiedAttestation.schemaId, 'atm.teamClosureAttestation.v1');
    assert.equal(satisfiedAttestation.localRuntimeWrapperIsSecureSandboxProof, false);
    assert.equal(satisfiedAttestation.commandBackedEvidenceRequired, true);
    assert.equal(satisfiedAttestation.brokerSubagent.schemaId, 'atm.teamBrokerSubagentContract.v1');
    assert.equal(satisfiedAttestation.brokerSubagent.enabled, true);
    assert.equal(satisfiedAttestation.brokerSubagent.decisionSurface, 'brokerLane');
    assert.equal(satisfiedAttestation.brokerSubagent.stewardId, 'neutral-write-steward');
    assert.deepEqual(satisfiedAttestation.brokerSubagent.governs, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.deepEqual(satisfiedAttestation.brokerSubagent.evidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
    assert.equal(satisfiedAttestation.brokerSubagent.authorityBoundary.fileWrite, false);
    assert.equal(satisfiedAttestation.brokerSubagent.authorityBoundary.gitWrite, false);
    assert.equal(satisfiedAttestation.brokerSubagent.authorityBoundary.taskLifecycle, false);
    assert.equal(satisfiedAttestation.brokerSubagent.authorityBoundary.selfClose, false);
    assert.equal(satisfiedAttestation.commitLane.schemaId, 'atm.teamCommitLaneContract.v1');
    assert.equal(satisfiedAttestation.commitLane.serializedBy, 'branch-commit-queue');
    assert.equal(satisfiedAttestation.commitLane.ownerRole, 'coordinator');
    assert.equal(satisfiedAttestation.commitLane.workerGitWrite, false);
    assert.equal(satisfiedAttestation.workerAuthorityBoundary.gitWrite, false);
    assert.equal(satisfiedAttestation.workerAuthorityBoundary.taskLifecycle, false);
    assert.equal(satisfiedAttestation.workerAuthorityBoundary.selfClose, false);
    assert.equal(satisfiedAttestation.workerAuthorityBoundary.evidenceWriteOwner, 'coordinator');
    assert.equal(satisfiedAttestation.reviewerIndependence.satisfied, true);
    assert.equal(unsatisfiedAttestation.reviewerIndependence.satisfied, false);

    const schema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'governance', 'closure-packet.schema.json'), 'utf8'));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const commandRun = {
      command: 'node --strip-types scripts/validate-team-agents.ts --case sandbox-attestation',
      cwd: '.',
      exitCode: 0,
      stdoutSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      stderrSha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      runnerVersion: '0.1.0'
    };
    const baseSchemaPacket = {
      schemaId: 'atm.closurePacket.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-TEAM-0019',
      targetRepoIdentity: {
        isFrameworkRepo: true,
        score: 2,
        root: '.',
        name: 'AI-Atomic-Framework',
        signals: ['package.json']
      },
      targetCommit: null,
      governedTreeSha: null,
      closedByCommand: 'atm tasks close',
      commandRuns: [commandRun],
      requiredGates: ['validate:team-agents'],
      evidencePath: '.atm/history/evidence/TASK-TEAM-0019.json',
      closedAt: '2026-06-18T00:00:00.000Z',
      closedByActor: 'validator'
    };
    assert.equal(validate({ ...baseSchemaPacket, teamClosureAttestation: satisfiedAttestation }), true, JSON.stringify(validate.errors));
    assert.equal(validate(baseSchemaPacket), true, 'closure packet without Team attestation remains valid');

    const governancePacket = {
      ...baseSchemaPacket,
      targetCommitDelta: { currentCommitSha: null, parentCommitShas: [], governedTreeSha: null, changedFiles: [] },
      validationPasses: ['validate:team-agents'],
      evidenceFreshness: 'fresh',
      requiredGatesSnapshot: {
        schemaId: 'atm.requiredGatesSnapshot.v1',
        generatedAt: '2026-06-18T00:00:00.000Z',
        source: 'frameworkStatus.requiredGates',
        ruleVersion: '0.1.0',
        frameworkMode: 'required',
        repoRole: 'framework',
        changedFiles: [],
        criticalChangedFiles: [],
        requiredGates: ['validate:team-agents']
      },
      teamClosureAttestation: satisfiedAttestation
    };
    assert.equal(validateClosurePacket(governancePacket).ok, true, 'governance validator must accept valid optional Team attestation');

    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-sandbox-attestation');
    rmSync(cwd, { recursive: true, force: true });
    try {
      const taskId = 'TASK-SANDBOX-ATTESTATION';
      mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
      mkdirSync(path.join(cwd, '.atm', 'history', 'evidence'), { recursive: true });
      writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
        schemaId: 'atm.taskLedger.v1',
        workItemId: taskId,
        title: 'Sandbox attestation fixture',
        status: 'running',
        targetRepo: 'AI-Atomic-Framework',
        closureAuthority: 'target_repo',
        scopePaths: ['packages/cli/src/commands/team.ts'],
        deliverables: ['packages/cli/src/commands/team.ts']
      }, null, 2)}\n`, 'utf8');

      writeFileSync(path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`), `${JSON.stringify({
        evidence: [
          {
            evidenceType: 'attestation',
            summary: 'valid Team runtime attestation',
            createdAt: '2026-06-18T00:00:00.000Z',
            details: satisfiedAttestation
          }
        ]
      }, null, 2)}\n`, 'utf8');
      const attestationOnly = verifyTaskEvidence({
        cwd,
        taskId,
        gate: 'close',
        frameworkTask: true
      });
      assert.equal(attestationOnly.ok, false, 'missing command-backed evidence must still fail');
      assert.ok(attestationOnly.missing.includes('code-or-framework-runnable-evidence'));

      writeFileSync(path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`), `${JSON.stringify({
        evidence: [
          {
            evidenceType: 'test',
            summary: 'failed validator fixture',
            createdAt: '2026-06-18T00:00:00.000Z',
            commandRuns: [{ ...commandRun, exitCode: 1 }],
            details: { validationPasses: [], teamClosureAttestation: satisfiedAttestation }
          }
        ]
      }, null, 2)}\n`, 'utf8');
      const failedValidator = verifyTaskEvidence({
        cwd,
        taskId,
        gate: 'close',
        frameworkTask: true
      });
      assert.equal(failedValidator.ok, false, 'failed validator plus valid attestation must still fail');
      assert.ok(failedValidator.missing.includes('code-or-framework-runnable-evidence'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (sandbox-attestation)');
    return true;
}
