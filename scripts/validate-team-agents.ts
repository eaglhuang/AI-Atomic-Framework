import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import { composeBrokerProposals } from '../packages/core/src/broker/compose.ts';
import { createClosurePacket, validateClosurePacket } from '../packages/cli/src/commands/framework-development.ts';
import { buildTeamArtifactHandoffEvidence, verifyTaskEvidence } from '../packages/cli/src/commands/evidence.ts';
import { TEAM_ATOM_BOUNDARIES, assessLieutenantEscalation, buildAnthropicRuntimeBridgeSummary, buildAtomizationChecklist, buildBrokerConflictSharedVocabulary, buildBrokerConflictUxProjection, buildDirectTeamRoleInstructions, buildEditorExecutionRuntimeBridgeSummary, buildMicrosoftFoundryRuntimeBridgeSummary, buildOpenAIFamilyRuntimeBridgeSummary, buildProviderNeutralRoleSkillPackManifest, buildReviewAgentSignature, buildTeamArtifactHandoffContract, buildTeamClosureAttestation, buildTeamPlan, buildTeamRetryBudgetContract, buildTeamReworkRouteStateMachine, buildTeamRuntimeContract, evaluateReviewQuorum, evaluateReviewerIndependence, evaluateTeamRequiredCompletionGate, loadTeamVendorLocalSecrets, runDirectTeamProviderRole, runTeamProviderExecution, runTeam, selectTeamImplementer, transitionTeamReworkRoute, validateTeamArtifactHandoff, validateTeamPermissionModel } from '../packages/cli/src/commands/team.ts';
import { evaluateClaimAdmission } from '../packages/cli/src/commands/next/claim-admission.ts';
import { evaluateBrokerQueueAdmission } from '../packages/cli/src/commands/next/broker-queue-admission.ts';
import { evaluateTaskflowBrokerConflictGate } from '../packages/cli/src/commands/taskflow/broker-gate.ts';
import { discoverGovernedVendorConfigSurface, inspectTeamRuntimeBackendCapabilities } from '../packages/cli/src/commands/integration.ts';
import { resolveNodejsTeamWorkerAdapter } from '../packages/core/src/team-runtime/nodejs-worker-adapter.ts';
import { TEAM_DIRECT_API_PROVIDER_IDS, TEAM_PROVIDER_IDS, createTeamProviderMetadata, supportsVendorNeutralProviders } from '../packages/core/src/team-runtime/provider-contract.ts';
import { TeamProviderRegistry } from '../packages/core/src/team-runtime/provider-registry.ts';
import { runProviderOrchestration } from '../packages/core/src/team-runtime/execution-orchestrator.ts';
import { advanceBrokerConflictResolution, createBrokerConflictResolutionArtifact, createDefaultTeamPermissionPolicy, decideBrokerConflictResolutionAdmission, decideTeamPermission } from '../packages/core/src/team-runtime/permission-broker.ts';
import { buildTeamObservabilityContract, createBrokerConflictObservabilityEvents, createTeamObservabilityEvent, queryTeamObservabilityEvents } from '../packages/core/src/team-runtime/observability.ts';
import { mergeTeamProviderSelectionConfig, resolveTeamProviderSelection } from '../packages/core/src/team-runtime/provider-selection.ts';
import { createAzureOpenAITeamProviderBridge, launchAzureOpenAITeamProviderRun, validateAzureOpenAITeamProviderConfig } from '../packages/core/src/team-runtime/providers/azure-openai.ts';
import { createClaudeCodeTeamProviderBridge, launchClaudeCodeTeamProviderRun, validateClaudeCodeTeamProviderConfig } from '../packages/core/src/team-runtime/providers/claude-code.ts';
import { createGeminiTeamProviderBridge, launchGeminiTeamProviderRun, validateGeminiTeamProviderConfig } from '../packages/core/src/team-runtime/providers/gemini.ts';
import { createGeminiDirectTeamProviderBridge, launchGeminiDirectTeamProviderRun } from '../packages/core/src/team-runtime/providers/gemini-direct.ts';
import { createMicrosoftFoundryTeamProviderBridge, launchMicrosoftFoundryTeamProviderRun, validateMicrosoftFoundryTeamProviderConfig } from '../packages/core/src/team-runtime/providers/microsoft-foundry.ts';
import { createOpenAITeamProviderBridge, launchOpenAITeamProviderRun, validateOpenAITeamProviderConfig } from '../packages/core/src/team-runtime/providers/openai.ts';
import { createAnthropicTeamProviderBridge, launchAnthropicTeamProviderRun, validateAnthropicTeamProviderConfig } from '../packages/core/src/team-runtime/providers/anthropic.ts';
import {
  validateScopeLeaseEpoch,
  validateScopeLeaseFencing,
  type ScopeLeaseRegistryEntry,
  type ScopeLeaseRunMode
} from '../packages/core/src/governance/scope-lock.ts';
import { planWaves, type WaveCandidateCard } from '../packages/core/src/broker/team-wave-planner.ts';
import { admitWave } from '../packages/core/src/broker/team-wave-admission.ts';
import { createTeamWaveEnvelope, validateTeamWaveEnvelope } from '../packages/core/src/broker/team-wave-envelope.ts';
import { buildTeamHandoffRetentionDecision, materializeTeamRoleHandoff, promoteTeamHandoffArchive, renderTeamHandoffIndex, teamHandoffHistoryDirectory, teamHandoffRuntimeDirectory, verifyTeamHandoffHistory, verifyTeamHandoffLedger } from '../packages/core/src/team-runtime/handoff-ledger.ts';
import { assertCoordinatorOnly, type WaveRole } from '../packages/cli/src/commands/team-wave.ts';
import { teamSpecBrokerLane, teamSpecPatrolReport, teamSpecRuntimeStatus } from '../packages/cli/src/commands/command-specs/team.spec.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';
import { runBrokerConflictResolutionReplayFixture } from './validate-mao-event-replay.ts';
import { evaluateTeamPreCommitGate, evaluateTeamPreToolGate } from '../packages/cli/src/commands/team-runtime-gates.ts';
import { runIntegrationHookInvocationInProcess } from '../packages/cli/src/commands/integration-hooks.ts';

const taskCase = getArg('--case') ?? 'lieutenant-escalation';

const sourceTeamRunSnapshot = snapshotSourceTeamRunFiles(process.cwd());
try {
  await main();
} finally {
  cleanupNewSourceTeamRunFiles(process.cwd(), sourceTeamRunSnapshot);
}

async function main() {
  // TASK-MAO-0027: Team Agents Wave Mode runtime self-check. Runs on every
  // invocation so any caller of this validator also asserts wave behavior.
  validateWaveMode();

  if (taskCase === 'next-claim-atomization') {
    // TASK-TEAM-0078: pin the structured admission log schema and the
    // line budgets of the claim-admission owner atoms.
    const { buildClaimAdmissionDecisionLog, CLAIM_ADMISSION_DECISION_LOG_KEYS, CLAIM_ADMISSION_GATE_NAMES } =
      await import('../packages/cli/src/commands/next/claim-conflict-log.ts');
    const { evaluateClaimAdmission } = await import('../packages/cli/src/commands/next/claim-admission.ts');
    const lineBudget = 600;
    const ownerModules = [
      'packages/cli/src/commands/next/broker-queue-admission.ts',
      'packages/cli/src/commands/next/claim-admission.ts',
      'packages/cli/src/commands/next/claim-conflict-log.ts'
    ];
    const atomDirectory = path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'next');
    const atomFiles = readdirSync(atomDirectory).filter((entry) => entry.endsWith('.ts'));
    for (const moduleFile of [...ownerModules, ...atomFiles.map((entry) => `packages/cli/src/commands/next/${entry}`)]) {
      const lineCount = readFileSync(path.join(process.cwd(), moduleFile), 'utf8').split('\n').length;
      assert.ok(lineCount < lineBudget, `${moduleFile} must stay under ${lineBudget} lines (found ${lineCount})`);
    }
    const atomMap = JSON.parse(readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8')) as { entries?: Record<string, unknown> } & Record<string, unknown>;
    const atomMapText = JSON.stringify(atomMap);
    for (const moduleFile of ownerModules) {
      assert.ok(atomMapText.includes(moduleFile), `atom map must contain an entry for ${moduleFile}`);
    }
    const queueAdmission = {
      schemaId: 'atm.brokerQueueAdmission.v1',
      taskId: 'TASK-A',
      status: 'queued-private-work',
      allowedFiles: ['src/private-a.ts'],
      queuedSharedPaths: ['src/shared.ts'],
      waitingOn: [{ surfacePath: 'src/shared.ts', queueHeadTaskId: 'TASK-B', position: 2 }],
      reason: 'Shared paths remain queued; the task may claim only its disjoint private paths.'
    } as const;
    const admittedDecision = evaluateClaimAdmission({
      brokerVerdict: 'watch',
      cidVerdict: 'parallel-safe-with-cid-overlap-advisory',
      candidateTaskId: 'TASK-A',
      conflictingTaskId: 'TASK-B',
      overlappingAtomIds: ['atom-1']
    });
    const admittedLog = buildClaimAdmissionDecisionLog({
      taskId: 'TASK-A',
      conflictTaskId: 'TASK-B',
      claimIntent: 'write',
      activeWriteConflict: false,
      confirmedBrokerConflict: false,
      insufficientMutationIntent: false,
      cidVerdict: 'parallel-safe-with-cid-overlap-advisory',
      brokerVerdict: 'watch',
      queueAdmission,
      overlappingFiles: ['src\\shared.ts', 'src/alpha.ts', 'src/shared.ts'],
      decision: admittedDecision,
      admissionReason: 'broker-shared-surface-queue-private-work'
    });
    assert.deepEqual(Object.keys(admittedLog), [...CLAIM_ADMISSION_DECISION_LOG_KEYS], 'decision log keys must stay stable');
    assert.deepEqual(admittedLog.gates.map((gate) => gate.gate), [...CLAIM_ADMISSION_GATE_NAMES], 'seven gate names must stay stable');
    assert.equal(admittedLog.gates.length, 7, 'decision log must explain exactly seven gates');
    assert.deepEqual(admittedLog.sharedPathOrder, ['src/alpha.ts', 'src/shared.ts'], 'shared path order must be normalized and sorted');
    assert.equal(admittedLog.queue.position, 2, 'queue position must surface the waiting position');
    assert.equal(admittedLog.privatePathAllowance.granted, true, 'private-path allowance must be granted for queued-private-work');
    assert.equal(admittedLog.admitted, true);
    assert.equal(admittedLog.blockReason, null);
    const blockedDecision = evaluateClaimAdmission({
      brokerVerdict: 'freeze',
      cidVerdict: 'blocked-cid-conflict',
      candidateTaskId: 'TASK-A',
      conflictingTaskId: 'TASK-B',
      overlappingAtomIds: ['atom-1']
    });
    const blockedLog = buildClaimAdmissionDecisionLog({
      taskId: 'TASK-A',
      conflictTaskId: 'TASK-B',
      claimIntent: 'write',
      activeWriteConflict: true,
      confirmedBrokerConflict: true,
      insufficientMutationIntent: false,
      cidVerdict: 'blocked-cid-conflict',
      brokerVerdict: 'freeze',
      queueAdmission: null,
      overlappingFiles: ['src/shared.ts'],
      decision: blockedDecision,
      admissionReason: null
    });
    assert.equal(blockedLog.admitted, false);
    assert.ok(blockedLog.blockReason && blockedLog.blockReason.includes('broker-conflict-blocked'), 'blocked log must carry the block reason');
    assert.equal(blockedLog.queue.status, 'not-evaluated');
    assert.equal(blockedLog.privatePathAllowance.granted, false);
    const serialized = JSON.stringify(admittedLog) + JSON.stringify(blockedLog);
    assert.equal(serialized.includes('redactedPreview'), false, 'decision log must not leak task body content');
    console.log('[validate-team-agents] ok (next-claim-atomization)');
    return;
  }

  if (taskCase === 'team-handoff-materialize') {
    const cwd = createTempWorkspace('atm-team-handoff-');
    const input = {
      cwd,
      taskId: 'TASK-TEAM-0072',
      teamRunId: 'handoff-test',
      fromRole: 'implementer',
      fromProviderId: 'openai',
      fromModelId: 'gpt-5-mini',
      toRole: 'reviewer',
      toProviderId: 'anthropic',
      sourceArtifactId: 'provider-session-1',
      redactedPreview: 'Implemented the runtime ledger. sk-live-secret-must-not-persist',
      leaseEpoch: 1,
      createdAt: '2026-07-11T00:00:00.000Z'
    } as const;
    const first = materializeTeamRoleHandoff(input);
    const second = materializeTeamRoleHandoff({ ...input, sourceArtifactId: 'provider-session-2', fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'claude-haiku', toRole: 'validator', leaseEpoch: 2, createdAt: '2026-07-11T00:01:00.000Z' });
    const directory = teamHandoffRuntimeDirectory(cwd, input.taskId, input.teamRunId);
    const verified = verifyTeamHandoffLedger(cwd, input.taskId, input.teamRunId);
    assert.equal(verified.ok, true, verified.reason ?? 'handoff ledger must verify');
    assert.equal(second.artifact.previousHandoffSha256, first.manifest.rootHandoffSha256);
    const index = readFileSync(path.join(directory, 'index.md'), 'utf8');
    assert.equal(index, renderTeamHandoffIndex(second.manifest, [first.artifact, second.artifact]));
    assert.equal(index.includes('sk-live-secret-must-not-persist'), false);
    assert.equal(readFileSync(path.join(directory, '0001-implementer.json'), 'utf8').includes('sk-live-secret-must-not-persist'), false);
    writeFileSync(path.join(directory, '0001-implementer.json'), '{}\n', 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, input.taskId, input.teamRunId).ok, false);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-materialize)');
    return;
  }

  if (taskCase === 'team-handoff-integrity') {
    const cwd = createTempWorkspace('atm-team-handoff-integrity-');
    const taskId = 'TASK-TEAM-0075';
    const teamRunId = 'integrity';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'source-1', redactedPreview: 'First.', leaseEpoch: 1 });
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'haiku', sourceArtifactId: 'source-2', redactedPreview: 'Second.', leaseEpoch: 2 });
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[1].sequence = 4;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'sequence gap must fail closed');
    const restoredManifest = { ...manifest, artifacts: manifest.artifacts.map((entry: any, index: number) => ({ ...entry, sequence: index + 1 })) };
    writeFileSync(manifestPath, `${JSON.stringify(restoredManifest, null, 2)}\n`, 'utf8');
    const secondPath = path.join(directory, restoredManifest.artifacts[1].file);
    const secondArtifact = JSON.parse(readFileSync(secondPath, 'utf8'));
    secondArtifact.previousHandoffSha256 = 'tampered-chain';
    const secondContent = `${JSON.stringify(secondArtifact, null, 2)}\n`;
    writeFileSync(secondPath, secondContent, 'utf8');
    const chainManifest = {
      ...restoredManifest,
      artifacts: restoredManifest.artifacts.map((entry: any, index: number) => index === 1 ? { ...entry, sha256: createHash('sha256').update(secondContent, 'utf8').digest('hex') } : entry)
    };
    chainManifest.rootHandoffSha256 = chainManifest.artifacts[1].sha256;
    writeFileSync(manifestPath, `${JSON.stringify(chainManifest, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(directory, 'index.md'), renderTeamHandoffIndex(chainManifest, [JSON.parse(readFileSync(path.join(directory, chainManifest.artifacts[0].file), 'utf8')), secondArtifact]), 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'hash-valid chain tamper must fail closed');
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-OTHER', teamRunId).ok, false, 'cross-task reads must fail closed');
    writeFileSync(path.join(directory, 'index.md'), '---\ntask_id: wrong\n---\n', 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'frontmatter drift must fail closed');
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-integrity)');
    return;
  }

  if (taskCase === 'team-handoff-hard-gate') {
    const cwd = createTempWorkspace('atm-team-handoff-gate-');
    const taskId = 'TASK-TEAM-0075';
    const teamRunId = 'bound-coordinator';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'source', redactedPreview: 'Bound coordinator only.', leaseEpoch: 1 });
    writeTeamRunForHandoffGate(cwd, taskId, teamRunId);
    await assert.rejects(
      () => runTeam(['handoff', 'show', '--task', taskId, '--team', teamRunId, '--actor', 'coordinator', '--cwd', cwd]),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED'
    );
    const authorized = await runTeam(['handoff', 'show', '--task', taskId, '--team', teamRunId, '--actor', 'bound-captain', '--cwd', cwd]) as any;
    assert.equal(authorized.ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-hard-gate)');
    return;
  }

  if (taskCase === 'team-handoff-continuation') {
    const cwd = createTempWorkspace('atm-team-handoff-continuation-');
    const taskId = 'TASK-TEAM-0075';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId: 'prior', fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'claude-haiku', sourceArtifactId: 'prior-source', redactedPreview: 'Prior terminal review.', leaseEpoch: 1 });
    promoteTeamHandoffArchive({ cwd, taskId, teamRunId: 'prior', runOutcome: 'aborted' });
    assert.equal(verifyTeamHandoffHistory(cwd, taskId, 'prior').ok, true);
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId: 'current', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'current-source', redactedPreview: 'Current retry.', leaseEpoch: 1 });
    writeTeamRunForHandoffGate(cwd, taskId, 'current');
    const result = await runTeam(['handoff', 'context', '--task', taskId, '--team', 'current', '--actor', 'bound-captain', '--continuation-from', 'prior', '--cwd', cwd]) as any;
    assert.equal(result.ok, true);
    const events = readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', 'current', 'observability-events.jsonl'), 'utf8');
    assert.ok(events.includes('handoff.consumed'));
    await assert.rejects(
      () => runTeam(['handoff', 'context', '--task', 'TASK-TEAM-OTHER', '--team', 'current', '--actor', 'bound-captain', '--continuation-from', 'prior', '--cwd', cwd]),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED'
    );
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-continuation)');
    return;
  }

  if (taskCase === 'team-handoff-retention') {
    assert.equal(buildTeamHandoffRetentionDecision({ transitionCount: 48, bytes: 1, softLimitReached: true, hardLimitReached: false }).statusCode, 'handoff-soft-limit-warning');
    assert.equal(buildTeamHandoffRetentionDecision({ transitionCount: 64, bytes: 1, softLimitReached: true, hardLimitReached: true }).decisionClass, 'human-signoff-required');
    console.log('[validate-team-agents] ok (team-handoff-retention)');
    return;
  }

  if (taskCase === 'team-handoff-aborted-promotion') {
    const cwd = createTempWorkspace('atm-team-handoff-archive-');
    materializeTeamRoleHandoff({ cwd, taskId: 'TASK-TEAM-0072', teamRunId: 'aborted', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'session', redactedPreview: 'Stopped after provider failure.', leaseEpoch: 1 });
    const archived = promoteTeamHandoffArchive({ cwd, taskId: 'TASK-TEAM-0072', teamRunId: 'aborted', runOutcome: 'aborted' });
    assert.equal(archived.manifest.runOutcome, 'aborted');
    assert.ok(existsSync(path.join(teamHandoffHistoryDirectory(cwd, 'TASK-TEAM-0072', 'aborted'), 'index.md')));
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-0072', 'aborted').ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-aborted-promotion)');
    return;
  }

  if (taskCase === 'team-handoff-context-budget') {
    const longSummary = Array.from({ length: 400 }, (_, index) => `token${index}`).join(' ');
    const context = buildDirectTeamRoleInstructions({
      taskId: 'TASK-TEAM-0073',
      role: 'reviewer',
      priorRoleArtifacts: Array.from({ length: 6 }, (_, index) => ({ role: `role${index}`, providerId: 'openai', outputTextPreview: longSummary }))
    });
    assert.equal(context.telemetry.priorArtifactCount, 4);
    assert.equal(context.telemetry.tokenEstimatorId, 'whitespace-v1');
    assert.ok(context.telemetry.actualTokenCount <= 1024 + 32, 'base instruction plus handoff must remain bounded');
    assert.equal(context.telemetry.consumedArtifactRefs[0], 'role2/openai');
    console.log('[validate-team-agents] ok (team-handoff-context-budget)');
    return;
  }

  if (taskCase === 'team-handoff-narrative-whitelist') {
    const cwd = createTempWorkspace('atm-team-handoff-whitelist-');
    const first = materializeTeamRoleHandoff({
      cwd, taskId: 'TASK-TEAM-0074', teamRunId: 'whitelist', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', toRole: 'reviewer', sourceArtifactId: 'provider-artifact', redactedPreview: 'Implemented the bounded handoff. sk-hidden-secret', leaseEpoch: 1, routeNote: 'needs-rework -> implementer (round 1/2)'
    });
    const directory = teamHandoffRuntimeDirectory(cwd, 'TASK-TEAM-0074', 'whitelist');
    const index = readFileSync(path.join(directory, 'index.md'), 'utf8');
    assert.equal(index, renderTeamHandoffIndex(first.manifest, [first.artifact]));
    assert.equal(index.includes('sk-hidden-secret'), false);
    assert.ok(index.includes(first.artifact.humanSummary));
    assert.ok(index.includes(first.artifact.routeNote!));
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-0074', 'whitelist').ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-narrative-whitelist)');
    return;
  }

  if (taskCase === 'broker-shared-surface-queue') {
    const cwd = createTempWorkspace('atm-broker-shared-queue-');
    mkdirSync(path.join(cwd, '.atm', 'runtime'), { recursive: true });
    const firstIntentPath = path.join(cwd, 'first.intent.json');
    const secondIntentPath = path.join(cwd, 'second.intent.json');
    const makeIntent = (taskId: string, actorId: string, atomId: string, atomCid: string, baseCommit = 'same-base') => ({
      schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'shared queue fixture' },
      taskId, actorId, baseCommit, targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', `src/${taskId}.ts`],
      atomRefs: [{ atomId, atomCid, operation: 'modify', sourceRange: { filePath: 'docs/governance/atm-bug-and-optimization-backlog.md', lineStart: 10, lineEnd: 12 } }],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] }, requestedLane: 'auto'
    });
    writeFileSync(firstIntentPath, `${JSON.stringify(makeIntent('TASK-QUEUE-ONE', 'agent-one', 'atom-one', 'cid-one'), null, 2)}\n`, 'utf8');
    writeFileSync(secondIntentPath, `${JSON.stringify(makeIntent('TASK-QUEUE-TWO', 'agent-two', 'atom-two', 'cid-two'), null, 2)}\n`, 'utf8');
    const first = await runBroker(['register', '--cwd', cwd, '--task', 'TASK-QUEUE-ONE', '--actor', 'agent-one', '--intent-file', firstIntentPath]);
    assert.equal(first.ok, true);
    const second = await runBroker(['register', '--cwd', cwd, '--task', 'TASK-QUEUE-TWO', '--actor', 'agent-two', '--intent-file', secondIntentPath]);
    assert.equal(second.ok, true, 'shared path must preserve private-path progress instead of globally blocking the task');
    const status = await runBroker(['status', '--cwd', cwd]);
    const queues = (status.evidence as { sharedSurfaceQueues?: Array<{ surfacePath: string; entries: Array<{ taskId: string }> }> }).sharedSurfaceQueues ?? [];
    assert.equal(queues.length, 1);
    assert.deepEqual(queues[0]?.entries.map((entry) => entry.taskId), ['TASK-QUEUE-ONE', 'TASK-QUEUE-TWO']);
    const teamStatus = await runTeam(['status', '--cwd', cwd]);
    assert.equal(((teamStatus.evidence as { sharedSurfaceQueues?: unknown[] }).sharedSurfaceQueues ?? []).length, 1);
    await runBroker(['release', '--cwd', cwd, '--task', 'TASK-QUEUE-ONE']);
    const afterRelease = await runBroker(['status', '--cwd', cwd]);
    const afterQueues = (afterRelease.evidence as { sharedSurfaceQueues?: Array<{ entries: Array<{ taskId: string }> }> }).sharedSurfaceQueues ?? [];
    assert.deepEqual(afterQueues[0]?.entries.map((entry) => entry.taskId), ['TASK-QUEUE-TWO']);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (broker-shared-surface-queue)');
    return;
  }

  if (taskCase === 'next-claim-shared-surface-queue') {
    const cwd = createTempWorkspace('atm-next-queue-admission-');
    const runtime = path.join(cwd, '.atm', 'runtime');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(path.join(runtime, 'broker-shared-surface-queues.json'), `${JSON.stringify({
      schemaId: 'atm.brokerSharedSurfaceQueues.v1',
      queues: [
        { schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', entries: [
          { taskId: 'TASK-OWNER', actorId: 'owner', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 1, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:00:00.000Z' },
          { taskId: 'TASK-WAITER', actorId: 'waiter', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 2, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:01:00.000Z' }
        ] },
        { schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', entries: [
          { taskId: 'TASK-OWNER', actorId: 'owner', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', leaseEpoch: 1, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:00:00.000Z' },
          { taskId: 'TASK-WAITER', actorId: 'waiter', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', leaseEpoch: 2, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:01:00.000Z' }
        ] }
      ]
    }, null, 2)}\n`, 'utf8');
    const privateWork = evaluateBrokerQueueAdmission({ cwd, taskId: 'TASK-WAITER', allowedFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', 'atomic_workbench/atomization-coverage/path-to-atom-map.json', 'packages/cli/src/commands/next.ts'], overlappingFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', 'atomic_workbench/atomization-coverage/path-to-atom-map.json'] });
    assert.equal(privateWork.status, 'queued-private-work');
    assert.deepEqual(privateWork.allowedFiles, ['packages/cli/src/commands/next.ts']);
    assert.equal(privateWork.waitingOn.length, 2);
    const blocked = evaluateBrokerQueueAdmission({ cwd, taskId: 'TASK-WAITER', allowedFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'], overlappingFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'] });
    assert.equal(blocked.status, 'queued-blocked');
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (next-claim-shared-surface-queue)');
    return;
  }

  if (taskCase === 'broker-shared-surface-compose') {
    const base = {
      schemaId: 'atm.patchProposal.v1' as const, specVersion: '0.1.0' as const, migration: { strategy: 'none' as const, fromVersion: null, notes: 'shared compose fixture' },
      taskId: 'TASK-COMPOSE', actorId: 'steward-fixture', baseCommit: 'base-1', fileBeforeHash: 'sha256:file-1', targetFile: 'docs/governance/atm-bug-and-optimization-backlog.md',
      validators: ['npm run typecheck'], rollback: 'revert fixture'
    };
    const first = { ...base, proposalId: 'proposal-one', atomRefs: [{ atomId: 'atom-one', atomCid: 'cid-one' }], anchors: [{ kind: 'line', hint: 'row-one' }], intent: 'bounded first row', patch: '@@ -1,1 +1,1 @@\n-one\n+one-a\n' };
    const second = { ...base, proposalId: 'proposal-two', atomRefs: [{ atomId: 'atom-two', atomCid: 'cid-two' }], anchors: [{ kind: 'line', hint: 'row-two' }], intent: 'bounded second row', patch: '@@ -4,1 +4,1 @@\n-two\n+two-b\n' };
    const compatible = composeBrokerProposals([second, first]);
    assert.equal(compatible.ok, true);
    assert.equal(compatible.mergePlan.verdict, 'parallel-safe');
    assert.deepEqual(compatible.mergePlan.inputProposals, ['proposal-one', 'proposal-two']);
    const semanticConflict = composeBrokerProposals([{ ...first, proposalId: 'proposal-three', atomRefs: [{ atomId: 'atom-three', atomCid: 'cid-three' }], anchors: [{ kind: 'markdown-heading', hint: 'same-row' }] }, { ...second, proposalId: 'proposal-four', atomRefs: [{ atomId: 'atom-four', atomCid: 'cid-four' }], anchors: [{ kind: 'markdown-heading', hint: 'same-row' }] }]);
    assert.equal(semanticConflict.mergePlan.verdict, 'needs-steward', 'Semantic Markdown anchors must never be auto-applied.');
    console.log('[validate-team-agents] ok (broker-shared-surface-compose)');
    return;
  }

  if (taskCase === 'lieutenant-escalation') {
    const lowRiskTask = {
      workItemId: 'TASK-TEAM-0008-SMALL',
      title: 'Small task crew dry-run',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['npm run typecheck'],
      acceptance: ['Captain keeps the crew small.']
    };

    const highRiskTask = {
      workItemId: 'TASK-TEAM-0008',
      title: 'Task lieutenant escalation rules',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      deliverables: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      validators: [
        'npm run typecheck',
        'npm run validate:cli',
        'node --strip-types scripts/validate-team-agents.ts --case lieutenant-escalation',
        'node atm.mjs team plan --task TASK-TEAM-0008 --json',
        'git diff --check'
      ],
      acceptance: [
        'Tasks touching more than two core files recommend Task Lieutenant.',
        'The output includes escalationRequired, escalationReason, needLieutenant, and nextTeamShape.'
      ]
    };

    const lowRisk = assessLieutenantEscalation(
      lowRiskTask,
      lowRiskTask.deliverables,
      { ok: true, findings: [] },
      safeBrokerLane(),
      buildAtomizationChecklist(lowRiskTask, lowRiskTask.deliverables)
    );

    assert.equal(lowRisk.escalationRequired, false);
    assert.equal(lowRisk.needLieutenant, false);
    assert.equal(lowRisk.nextTeamShape.lieutenant.recommended, false);
    assert.deepEqual(lowRisk.nextTeamShape.lieutenant.permissions, ['file.read', 'exec.validator']);
    assert.deepEqual(lowRisk.nextTeamShape.lieutenant.forbiddenPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);
    assert.deepEqual(lowRisk.nextTeamShape.captain.permissions, ['task.lifecycle', 'git.write', 'evidence.write']);

    const highRisk = assessLieutenantEscalation(
      highRiskTask,
      highRiskTask.deliverables,
      { ok: true, findings: [] },
      safeBrokerLane(),
      buildAtomizationChecklist(highRiskTask, highRiskTask.deliverables)
    );

    assert.equal(highRisk.escalationRequired, true);
    assert.equal(highRisk.needLieutenant, true);
    assert.equal(highRisk.nextTeamShape.lieutenant.recommended, true);
    assert.equal(highRisk.nextTeamShape.coordinationBoundary, 'captain+lieutenant');
    assert.ok(highRisk.escalationReason.includes('explicitly governs lieutenant escalation rules'));
    assert.ok(highRisk.escalationReason.includes('Scope spans'));
    assert.ok(highRisk.escalationReason.includes('Validator fan-out'));
    assert.ok(highRisk.nextTeamShape.signals.largeScriptRisk);
    assert.equal(highRisk.nextTeamShape.signals.scopeCount, 4);

    console.log('[validate-team-agents] ok (lieutenant-escalation)');
    return;
  }

  if (taskCase === 'source-runtime-residue-cleanup') {
    const cleanupRoot = path.join(createTempWorkspace('atm-team-source-cleanup-'), 'source');
    const teamRunDir = path.join(cleanupRoot, '.atm', 'runtime', 'team-runs');
    mkdirSync(teamRunDir, { recursive: true });
    const existingPath = path.join(teamRunDir, 'team-existing.json');
    const residuePath = path.join(teamRunDir, 'team-validator-residue.json');
    writeFileSync(existingPath, '{}\n', 'utf8');
    const snapshot = snapshotSourceTeamRunFiles(cleanupRoot);
    writeFileSync(residuePath, '{}\n', 'utf8');
    cleanupNewSourceTeamRunFiles(cleanupRoot, snapshot);
    assert.equal(existsSync(existingPath), true, 'cleanup must preserve pre-existing team runtime files');
    assert.equal(existsSync(residuePath), false, 'cleanup must remove validator-created source runtime residue');
    rmSync(path.dirname(cleanupRoot), { recursive: true, force: true });

    console.log('[validate-team-agents] ok (source-runtime-residue-cleanup)');
    return;
  }

  if (taskCase === 'plan-resolver') {
    const result = await runTeam(['plan', '--task', 'TASK-TEAM-0009', '--cwd', process.cwd(), '--json']);

    const evidence = result.evidence as any;
    assert.equal(evidence?.action, 'plan');
    assert.equal(evidence?.dryRun, true);
    assert.equal(evidence?.runtimeWritten, false);
    assert.equal(evidence?.agentsSpawned, false);
    assert.equal(evidence?.task?.taskId, 'TASK-TEAM-0009');
    assert.equal(evidence?.task?.title, 'Team plan dry-run resolver');
    assert.equal(evidence?.recipe?.schemaId, 'atm.teamRecipe.v1');
    assert.equal(evidence?.recipe?.recipeId, 'atm.default.normal.typescript');
    assert.equal(evidence?.teamPlan?.schemaId, 'atm.teamPlan.v1');
    assert.equal(evidence?.teamPlan?.recipeId, 'atm.default.normal.typescript');
    assert.equal(evidence?.teamPlan?.channelHint, 'normal');
    assert.equal(evidence?.teamPlan?.implementerSelector?.schemaId, 'atm.teamImplementerSelector.v1');
    assert.equal(evidence?.teamPlan?.implementerSelector?.selectedImplementer?.agentId, 'implementer-typescript');
    assert.equal(evidence?.teamPlan?.implementerSelector?.languageMatch, 'typescript');
    assert.equal(evidence?.teamPlan?.implementerSelector?.roleMatch, 'typescript-implementer');
    assert.equal(evidence?.teamPlan?.implementerSelector?.confidence, 'high');
    assert.deepEqual(evidence?.teamPlan?.captainDecision?.implementerSelector, evidence?.teamPlan?.implementerSelector);
    const findings = evidence?.teamPlan?.validation?.findings ?? [];
    const onlyActiveClaimConflict = findings.length === 1 && findings[0]?.code === 'blocked-cid-conflict';
    assert.equal(result.ok, evidence?.teamPlan?.validation?.ok === true, 'plan ok must mirror permission validation state');
    assert.equal(evidence?.teamPlan?.validation?.ok === true || onlyActiveClaimConflict, true, 'plan-resolver permits only active-claim CID conflict as a transient regression condition');
    assert.equal(typeof evidence?.teamPlan?.brokerLane?.decision?.verdict, 'string');
    assert.equal(evidence?.teamPlan?.briefingContract?.taskId, 'TASK-TEAM-0009');
    assert.deepEqual(evidence?.teamPlan?.briefingContract?.allowedFiles, [
      'atomic_workbench/atomization-coverage/path-to-atom-map.json',
      'packages/cli/src/commands/command-specs/team.spec.ts',
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts'
    ]);
    assert.equal(evidence?.teamPlan?.captainDecision?.taskId, 'TASK-TEAM-0009');
    assert.equal(evidence?.teamPlan?.captainDecision?.nextTeamShape?.coordinationBoundary, 'captain+lieutenant');
    assert.equal(evidence?.teamPlan?.captainDecision?.nextTeamShape?.signals?.scopeCount, 4);
    assert.deepEqual(evidence?.teamPlan?.suggestedPermissionLeases?.map((lease: any) => lease.permission).sort(), [
      'evidence.write',
      'file.write',
      'git.write',
      'task.lifecycle'
    ]);
    assert.ok(Array.isArray(evidence?.teamPlan?.nextSteps) && evidence.teamPlan.nextSteps.includes('Review this dry-run plan.'));

    await assert.rejects(
      () => runTeam(['plan', '--task', 'TASK-TEAM-MISSING', '--cwd', process.cwd(), '--json']),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_TASK_NOT_FOUND'
    );

    console.log('[validate-team-agents] ok (plan-resolver)');
    return;
  }

  if (taskCase === 'role-selector') {
    const result = await runTeam(['plan', '--task', 'TASK-TEAM-0010', '--cwd', process.cwd(), '--json']);

    const evidence = result.evidence as any;
    const findings = evidence?.teamPlan?.validation?.findings ?? [];
    const onlyActiveLeaseConflict = findings.length === 1 && ['blocked-cid-conflict', 'blocked-broker-cid-conflict'].includes(findings[0]?.code);
    assert.equal(result.ok, evidence?.teamPlan?.validation?.ok === true, 'plan ok must mirror permission validation state');
    assert.equal(evidence?.teamPlan?.validation?.ok === true || onlyActiveLeaseConflict, true, 'role-selector permits only active-lease/broker CID conflict as a transient validation condition');
    const selection = evidence?.teamPlan?.implementerSelector;
    assert.equal(selection?.schemaId, 'atm.teamImplementerSelector.v1');
    assert.equal(selection?.selectedImplementer?.agentId, 'implementer-typescript');
    assert.equal(selection?.selectedImplementer?.role, 'implementer');
    assert.equal(selection?.selectedImplementer?.profile, 'atm.implementer.typescript.v1');
    assert.equal(selection?.selectedImplementer?.language, 'typescript');
    assert.equal(selection?.languageMatch, 'typescript');
    assert.equal(selection?.roleMatch, 'typescript-implementer');
    assert.ok(selection?.deterministicHints?.scopePaths?.includes('packages/cli/src/commands/team.ts'));
    assert.ok(selection?.deterministicHints?.fileExtensions?.includes('.ts'));
    assert.ok(selection?.fallbackReason?.includes('No fallback needed'));
    assert.equal(selection?.confidence, 'high');
    assert.deepEqual(evidence?.teamPlan?.captainDecision?.implementerSelector, selection);

    const recipe = {
      schemaId: 'atm.teamRecipe.v1',
      recipeId: 'validator.fixture',
      agents: [
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    } as any;
    const pythonRecipe = {
      ...recipe,
      agents: [
        ...recipe.agents,
        { agentId: 'implementer-python', role: 'implementer', profile: 'atm.implementer.python.v1', language: 'python', permissions: ['file.write'] }
      ]
    } as any;
    const uiRecipe = {
      ...recipe,
      agents: [
        ...recipe.agents,
        { agentId: 'implementer-adopter-ui', role: 'ui-implementer', profile: 'atm.implementer.adopter-ui.v1', language: 'typescript', permissions: ['file.write'] }
      ]
    } as any;
    const genericRecipe = {
      ...recipe,
      agents: [
        { agentId: 'implementer-generic', role: 'implementer', profile: 'atm.implementer.generic.v1', language: 'generic', permissions: ['file.write'] }
      ]
    } as any;
    const pythonSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-PY',
      title: 'Python data pipeline task',
      scopePaths: ['tools/pipeline/extract.py', 'requirements.txt'],
      deliverables: ['tools/pipeline/extract.py']
    }, pythonRecipe, ['tools/pipeline/extract.py']);
    assert.equal(pythonSelection.selectedImplementer.agentId, 'implementer-python');
    assert.equal(pythonSelection.selectedImplementer.language, 'python');
    assert.equal(pythonSelection.languageMatch, 'python');
    assert.equal(pythonSelection.roleMatch, 'python-implementer');
    assert.ok(pythonSelection.fallbackReason.includes('No fallback needed'));

    const uiSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-UI',
      title: 'Adopter UI task',
      scopePaths: ['assets/scripts/ui/scenes/LoadingScene.ts'],
      deliverables: ['assets/scripts/ui/scenes/LoadingScene.ts']
    }, uiRecipe, ['assets/scripts/ui/scenes/LoadingScene.ts']);
    assert.equal(uiSelection.selectedImplementer.agentId, 'implementer-adopter-ui');
    assert.equal(uiSelection.languageMatch, 'typescript');
    assert.equal(uiSelection.roleMatch, 'ui-implementer');
    assert.ok(uiSelection.fallbackReason.includes('No fallback needed'));

    const genericSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-UNKNOWN',
      title: 'Generic documentation task',
      scopePaths: ['docs/notes/readme.md'],
      deliverables: ['docs/notes/readme.md']
    }, genericRecipe, ['docs/notes/readme.md']);
    assert.equal(genericSelection.selectedImplementer.agentId, 'implementer-generic');
    assert.equal(genericSelection.languageMatch, 'unknown');
    assert.equal(genericSelection.roleMatch, 'generic-implementer');
    assert.ok(genericSelection.fallbackReason.includes('generic implementer'));
    assert.equal(genericSelection.confidence, 'low');

    console.log('[validate-team-agents] ok (role-selector)');
    return;
  }

  if (taskCase === 'permission-lease') {
    type FixtureAgent = {
      agentId: string;
      role: string;
      profile?: string;
      language?: string;
      permissions: string[];
    };
    const healthyRecipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.healthy',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ] satisfies FixtureAgent[]
    };
    const writePaths = ['packages/cli/src/commands/team.ts'];

    const healthy = validateTeamPermissionModel(healthyRecipe, writePaths);
    assert.equal(healthy.ok, true);
    assert.equal(healthy.findings.length, 0);

    const duplicateOwnersRecipe = {
      ...healthyRecipe,
      agents: [
        ...healthyRecipe.agents,
        { agentId: 'extra-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['git.write'] }
      ]
    } as any;
    const duplicateOwners = validateTeamPermissionModel(duplicateOwnersRecipe, writePaths);
    assert.equal(duplicateOwners.ok, false);
    const duplicateFinding = duplicateOwners.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_CONFLICT' && finding.permission === 'git.write');
    assert.ok(duplicateFinding);
    assert.ok(duplicateFinding?.summary);
    assert.ok(duplicateFinding?.suggestedFix);
    assert.equal(duplicateFinding?.permission, 'git.write');

    const scopedLeaseMissing = validateTeamPermissionModel(healthyRecipe, []);
    assert.equal(scopedLeaseMissing.ok, false);
    const scopeFinding = scopedLeaseMissing.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED' && finding.permission === 'file.write');
    assert.ok(scopeFinding);
    assert.ok(scopeFinding?.summary);
    assert.ok(scopeFinding?.role);
    assert.ok(scopeFinding?.suggestedFix);

    const evidenceWriteDriftRecipe = {
      ...healthyRecipe,
      agents: healthyRecipe.agents.map((agent) => agent.role === 'coordinator'
        ? { ...agent, permissions: ['task.lifecycle', 'git.write'] }
        : agent.role === 'implementer'
          ? { ...agent, permissions: ['file.write', 'evidence.write'] }
          : agent)
    };
    const evidenceWriteDrift = validateTeamPermissionModel(evidenceWriteDriftRecipe, writePaths);
    assert.equal(evidenceWriteDrift.ok, false);
    const evidenceFinding = evidenceWriteDrift.findings.find((finding) => finding.code === 'ATM_TEAM_UNIQUE_OWNER_REQUIRED' && finding.permission === 'evidence.write');
    assert.ok(evidenceFinding);
    assert.ok(evidenceFinding?.summary);
    assert.ok(evidenceFinding?.suggestedFix);

    const readOnlyWriteRecipe = {
      ...healthyRecipe,
      agents: healthyRecipe.agents.map((agent) => agent.role === 'scopeGuardian'
        ? { ...agent, permissions: ['file.read', 'file.write'] }
        : agent)
    };
    const readOnlyWrite = validateTeamPermissionModel(readOnlyWriteRecipe, writePaths);
    assert.equal(readOnlyWrite.ok, false);
    const readOnlyFinding = readOnlyWrite.findings.find((finding) => finding.code === 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN');
    assert.ok(readOnlyFinding);
    assert.equal(readOnlyFinding?.role, 'scopeGuardian');
    assert.ok(readOnlyFinding?.summary);
    assert.ok(readOnlyFinding?.suggestedFix);

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0012', '--cwd', process.cwd(), '--json']);
    const evidence = validateResult.evidence as any;
    assert.equal(validateResult.ok, true);
    assert.equal(evidence?.action, 'validate');
    assert.equal(evidence?.validation?.ok, true);
    assert.ok(Array.isArray(evidence?.validation?.findings));
    assert.ok(Array.isArray(evidence?.suggestedPermissionLeases));
    assert.deepEqual(
      evidence?.suggestedPermissionLeases?.map((lease: any) => lease.permission).sort(),
      ['evidence.write', 'file.write', 'git.write', 'task.lifecycle']
    );

    const crossRepoRoot = createTempWorkspace('team-cross-repo-planning-');
    const targetRepo = path.join(crossRepoRoot, 'target');
    const planningRepo = path.join(crossRepoRoot, 'planning');
    const planningCardPath = path.join(planningRepo, 'docs', 'ai_atomic_framework', 'rft-hardening', 'tasks', 'TASK-AAO-0118.task.md');
    mkdirSync(path.join(targetRepo, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.dirname(planningCardPath), { recursive: true });
    writeFileSync(planningCardPath, '# Planning-only Phase 0 card\n', 'utf8');
    writeFileSync(path.join(targetRepo, '.atm', 'history', 'tasks', 'TASK-CROSS-PLANNING.json'), `${JSON.stringify({
      schemaId: 'atm.task.v1',
      workItemId: 'TASK-CROSS-PLANNING',
      title: 'Cross repo planning-only team validation',
      status: 'ready',
      planningRepo,
      targetRepo,
      scopePaths: [planningCardPath],
      deliverables: [],
      validators: ['node --version']
    }, null, 2)}\n`, 'utf8');
    try {
      const planningOnly = await runTeam(['validate', '--task', 'TASK-CROSS-PLANNING', '--cwd', targetRepo, '--json']);
      const planningOnlyEvidence = planningOnly.evidence as any;
      assert.equal(planningOnly.ok, true, 'planning-repo absolute scope paths must not block Team validate as write traversal');
      assert.equal(planningOnlyEvidence?.validation?.ok, true);
      assert.deepEqual(planningOnlyEvidence?.suggestedPermissionLeases?.filter((lease: any) => lease.permission === 'file.write') ?? [], []);
      assert.equal(
        planningOnlyEvidence?.validation?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'),
        false,
        'planning-repo absolute paths must be classified away from file.write traversal findings'
      );
    } finally {
      rmSync(crossRepoRoot, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (permission-lease)');
    return;
  }

  if (taskCase === 'vendor-neutral-runtime-contract') {
    const metadata = TEAM_PROVIDER_IDS.map((providerId) => createTeamProviderMetadata(providerId));
    assert.equal(supportsVendorNeutralProviders(metadata), true);
    const registry = new TeamProviderRegistry();
    registry.registerDefaults(TEAM_PROVIDER_IDS);
    assert.equal(registry.list().length, TEAM_PROVIDER_IDS.length);
    const provider = registry.get('claude-code');
    assert.ok(provider);
    const orchestration = await runProviderOrchestration(provider!, {
      taskId: 'TASK-TEAM-0037',
      role: 'implementer',
      runtimeMode: 'broker-only',
      providerId: 'claude-code',
      sdkId: 'claude-code',
      modelId: 'claude-opus',
      retries: 2
    });
    assert.equal(orchestration.ok, true);
    assert.equal(orchestration.coordinatorOwnedAuthority, true);
    console.log('[validate-team-agents] ok (vendor-neutral-runtime-contract)');
    return;
  }

  if (taskCase === 'team-start-execution-wiring') {
    let attemptCount = 0;
    const provider = {
      schemaId: 'atm.teamProviderContract.v1' as const,
      metadata: createTeamProviderMetadata('openai'),
      sessionLifecycle: {
        createSession: true as const,
        closeSession: true as const,
        cancelSession: true as const,
        retryStep: true as const
      },
      openSession(request: any) {
        return { sessionId: `${request.taskId}:${request.role}:${request.providerId}:${request.modelId}`, providerId: 'openai' as const };
      },
      executeStep(input: any) {
        attemptCount += 1;
        return {
          ok: attemptCount > 1,
          outputText: `attempt ${attemptCount} for ${input.request.role}`,
          outputArtifacts: ['agent-report', `role-${input.request.role}`],
          retryable: attemptCount === 1,
          summary: attemptCount > 1 ? 'fake provider completed' : 'fake provider retry requested',
          executionMode: 'vendor-api' as const
        };
      },
      closeSession(sessionId: string) {
        return { closed: true as const, sessionId };
      },
      cancelSession(sessionId: string, reason: string) {
        return { cancelled: true as const, sessionId, reason };
      }
    };
    const orchestration = await runProviderOrchestration(provider, {
      taskId: 'TASK-TEAM-0050',
      role: 'implementer',
      runtimeMode: 'real-agent',
      providerId: 'openai',
      sdkId: 'openai-responses',
      modelId: 'gpt-5-mini',
      retries: 2
    });
    assert.equal(orchestration.ok, true);
    assert.equal(orchestration.attempts, 2);
    assert.equal(attemptCount, 2);
    assert.equal(orchestration.sessionId, 'TASK-TEAM-0050:implementer:openai:gpt-5-mini');
    assert.deepEqual(orchestration.stepResult.artifacts, ['agent-report', 'role-implementer']);
    console.log('[validate-team-agents] ok (team-start-execution-wiring)');
    return;
  }

  if (taskCase === 'team-vendor-local-secrets') {
    const workspace = createTempWorkspace('team-vendor-local-secrets');
    const secretDir = path.join(workspace, 'agent-integrations', 'vendors');
    mkdirSync(secretDir, { recursive: true });
    writeFileSync(path.join(secretDir, 'team-secrets.local.json'), JSON.stringify({
      schemaId: 'atm.teamVendorSecrets.local.v1',
      providers: {
        openai: {
          OPENAI_API_KEY: 'local-openai-test-token'
        },
        anthropic: {
          ANTHROPIC_API_KEY: 'anthropic-test-local-secret'
        }
      },
      env: {
        AZURE_ACCESS_TOKEN: 'azure-test-local-token'
      }
    }, null, 2));
    const loaded = loadTeamVendorLocalSecrets(workspace);
    assert.equal(loaded.summary.loaded, true);
    assert.equal(loaded.summary.providerCount, 2);
    assert.equal(loaded.summary.secretRefCount, 3);
    assert.deepEqual(loaded.summary.secretRefs, ['ANTHROPIC_API_KEY', 'AZURE_ACCESS_TOKEN', 'OPENAI_API_KEY']);
    assert.equal(loaded.summary.rawSecretsLogged, false);
    assert.ok(!JSON.stringify(loaded.summary).includes('local-openai-test-token'));
    assert.equal(loaded.env.OPENAI_API_KEY, 'local-openai-test-token');

    let observedEnv: Record<string, string | undefined> | undefined;
    const provider = {
      schemaId: 'atm.teamProviderContract.v1' as const,
      metadata: createTeamProviderMetadata('openai'),
      sessionLifecycle: {
        createSession: true as const,
        closeSession: true as const,
        cancelSession: true as const,
        retryStep: true as const
      },
      openSession(request: any) {
        return { sessionId: `${request.taskId}:${request.role}:${request.providerId}:${request.modelId}`, providerId: 'openai' as const };
      },
      executeStep(input: any) {
        observedEnv = input.env;
        return {
          ok: true,
          outputText: 'local secret env observed',
          outputArtifacts: ['agent-report'],
          retryable: false,
          summary: 'fake provider read local secret env map',
          executionMode: 'vendor-api' as const
        };
      },
      closeSession(sessionId: string) {
        return { closed: true as const, sessionId };
      },
      cancelSession(sessionId: string, reason: string) {
        return { cancelled: true as const, sessionId, reason };
      }
    };
    await runProviderOrchestration(provider, {
      taskId: 'TASK-TEAM-SECRETS',
      role: 'validator',
      runtimeMode: 'real-agent',
      providerId: 'openai',
      sdkId: 'responses',
      modelId: 'gpt-5-mini',
      env: loaded.env
    });
    assert.equal(observedEnv?.OPENAI_API_KEY, 'local-openai-test-token');
    console.log('[validate-team-agents] ok (team-vendor-local-secrets)');
    return;
  }

  if (taskCase === 'heterogeneous-multi-bot-team-run') {
    const makeProvider = (providerId: 'openai' | 'claude-code') => ({
      schemaId: 'atm.teamProviderContract.v1' as const,
      metadata: createTeamProviderMetadata(providerId),
      sessionLifecycle: {
        createSession: true as const,
        closeSession: true as const,
        cancelSession: true as const,
        retryStep: true as const
      },
      openSession(request: any) {
        return { sessionId: `${request.taskId}:${request.role}:${request.providerId}:${request.modelId}`, providerId };
      },
      executeStep(input: any) {
        if (input.request.role === 'validator') {
          return {
            ok: false,
            outputText: 'broker-conflict-blocked',
            outputArtifacts: ['atm.brokerConflictResolution.v1'],
            retryable: false,
            summary: 'single role blocked by broker conflict',
            executionMode: 'vendor-api' as const
          };
        }
        return {
          ok: true,
          outputText: `completed ${input.request.role}`,
          outputArtifacts: ['atm.teamProviderRunArtifact.v1', `role-${input.request.role}`],
          retryable: false,
          summary: `${providerId} fake executor completed`,
          executionMode: providerId === 'openai' ? 'vendor-api' as const : 'editor-cli' as const
        };
      },
      closeSession(sessionId: string) {
        return { closed: true as const, sessionId };
      },
      cancelSession(sessionId: string, reason: string) {
        return { cancelled: true as const, sessionId, reason };
      }
    });
    const requests = [
      { role: 'implementer', providerId: 'openai' as const, sdkId: 'responses', modelId: 'gpt-5-mini' },
      { role: 'reader', providerId: 'claude-code' as const, sdkId: 'claude-code', modelId: 'claude-sonnet' },
      { role: 'validator', providerId: 'openai' as const, sdkId: 'responses', modelId: 'gpt-5-mini' }
    ];
    const results = await Promise.all(requests.map((request) => runProviderOrchestration(makeProvider(request.providerId), {
      taskId: 'TASK-TEAM-0052',
      role: request.role,
      runtimeMode: request.providerId === 'openai' ? 'real-agent' : 'editor-subagent',
      providerId: request.providerId,
      sdkId: request.sdkId,
      modelId: request.modelId,
      retries: 1
    })));
    assert.equal(new Set(results.map((result) => result.providerId)).size, 2);
    assert.deepEqual(results.map((result) => result.sessionId), [
      'TASK-TEAM-0052:implementer:openai:gpt-5-mini',
      'TASK-TEAM-0052:reader:claude-code:claude-sonnet',
      'TASK-TEAM-0052:validator:openai:gpt-5-mini'
    ]);
    assert.equal(results.filter((result) => result.ok).length, 2);
    assert.equal(results.find((result) => result.stepResult.role === 'validator')?.stepResult.summary, 'single role blocked by broker conflict');
    assert.ok(results.filter((result) => result.ok).every((result) => result.stepResult.artifacts.includes('atm.teamProviderRunArtifact.v1')));
    console.log('[validate-team-agents] ok (heterogeneous-multi-bot-team-run)');
    return;
  }

  if (taskCase === 'runtime-tier-contract') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.runtime-tier',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const plan = buildTeamPlan({
      task: { workItemId: 'TASK-TEAM-0062', title: 'Runtime tier contract' },
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L5'
    }) as any;
    assert.equal(plan.runtimeTierContract.schemaId, 'atm.teamRuntimeTierContract.v1');
    const roleTiers = Object.fromEntries(plan.runtimeTierContract.roleTiers.map((entry: any) => [entry.role, entry.runtimeTier]));
    assert.equal(roleTiers.reader, 'raw-api');
    assert.equal(roleTiers.validator, 'raw-api');
    assert.equal(roleTiers.reviewAgent, 'raw-api');
    assert.equal(roleTiers.knowledgeScout, 'raw-api');
    assert.equal(roleTiers.implementer, 'agent-sdk');
    assert.equal(roleTiers.coordinator, 'agent-sdk');
    assert.equal(roleTiers.lieutenant, 'editor');
    assert.ok(plan.runtimeTierContract.providerContractCompatibility.includes('RawChatAdapter'));
    console.log('[validate-team-agents] ok (runtime-tier-contract)');
    return;
  }

  if (taskCase === 'provider-permission-broker') {
    const policy = createDefaultTeamPermissionPolicy();
    const allow = decideTeamPermission(policy, {
      permission: 'exec.validator',
      providerId: 'openai',
      scopedPaths: ['packages/cli/src/commands/team.ts']
    });
    assert.equal(allow.ok, true);
    const deny = decideTeamPermission(policy, {
      permission: 'git.write',
      providerId: 'gemini',
      scopedPaths: []
    });
    assert.equal(deny.ok, false);
    console.log('[validate-team-agents] ok (provider-permission-broker)');
    return;
  }

  if (taskCase === 'anthropic-direct-bridge') {
    assert.ok(TEAM_PROVIDER_IDS.includes('anthropic'));
    const incomplete = validateAnthropicTeamProviderConfig({
      schemaId: 'atm.anthropicTeamProviderConfig.v1',
      providerId: 'anthropic',
      sdkId: 'anthropic-messages',
      modelId: ''
    });
    assert.equal(incomplete.ok, false);
    assert.ok(incomplete.missingFields.includes('modelId'));
    assert.ok(incomplete.missingFields.includes('apiKeyEnvVar'));
    const bridge = createAnthropicTeamProviderBridge({
      schemaId: 'atm.anthropicTeamProviderConfig.v1',
      providerId: 'anthropic',
      sdkId: 'anthropic-messages',
      modelId: 'claude-3-5-sonnet',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY'
    });
    let observedRequest: any = null;
    const result = await launchAnthropicTeamProviderRun({
      bridge,
      request: {
        taskId: 'TASK-TEAM-0063',
        role: 'validator',
        runtimeMode: 'real-agent',
        providerId: 'anthropic',
        sdkId: 'anthropic-messages',
        modelId: 'claude-3-5-sonnet',
        instructions: 'Validate Anthropic bridge.'
      },
      permissionPolicy: createDefaultTeamPermissionPolicy(),
      scopedPaths: ['packages/core/src/team-runtime/providers/anthropic.ts'],
      env: { ANTHROPIC_API_KEY: 'secret-test-key' },
      emittedAt: '2026-07-10T02:00:00.000Z',
      executor: async (request) => {
        observedRequest = request;
        return {
          ok: true,
          statusCode: 200,
          outputText: 'anthropic fake executor completed',
          outputArtifacts: ['agent-report', 'evidence-summary'],
          retryable: false,
          summary: 'Anthropic Messages API fake request completed.',
          executionMode: 'vendor-api'
        };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.providerId, 'anthropic');
    assert.equal(result.artifact.providerId, 'anthropic');
    assert.equal(result.artifact.redaction.rawSecretsLogged, false);
    assert.equal(result.observabilityEvents.length, 3);
    assert.equal(observedRequest.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(observedRequest.headers['anthropic-version'], '2023-06-01');
    assert.equal(observedRequest.body.model, 'claude-3-5-sonnet');
    assert.equal(observedRequest.body.messages[0].role, 'user');
    const summary = buildAnthropicRuntimeBridgeSummary();
    assert.equal(summary.providerIds[0], 'anthropic');
    assert.equal(summary.bridges[0].executionSurface, 'anthropic-messages-http');
    console.log('[validate-team-agents] ok (anthropic-direct-bridge)');
    return;
  }

  if (taskCase === 'openai-azure-openai-bridges') {
    const incompleteOpenAI = validateOpenAITeamProviderConfig({
      schemaId: 'atm.openaiTeamProviderConfig.v1',
      providerId: 'openai',
      sdkId: 'openai-responses',
      modelId: '',
      apiKeyEnvVar: ''
    });
    assert.equal(incompleteOpenAI.ok, false);
    assert.deepEqual(incompleteOpenAI.missingFields, ['modelId', 'apiKeyEnvVar']);
    assert.equal(incompleteOpenAI.rawSecretsLogged, false);

    const incompleteAzure = validateAzureOpenAITeamProviderConfig({
      schemaId: 'atm.azureOpenAITeamProviderConfig.v1',
      providerId: 'azure-openai',
      sdkId: 'azure-openai-responses',
      endpointEnvVar: 'AZURE_OPENAI_ENDPOINT',
      deploymentName: '',
      modelId: 'gpt-5-mini',
      authMode: 'api-key-env',
      apiKeyEnvVar: ''
    });
    assert.equal(incompleteAzure.ok, false);
    assert.ok(incompleteAzure.missingFields.includes('deploymentName'));
    assert.ok(incompleteAzure.missingFields.includes('apiKeyEnvVar'));

    const openaiBridge = createOpenAITeamProviderBridge({
      schemaId: 'atm.openaiTeamProviderConfig.v1',
      providerId: 'openai',
      sdkId: 'openai-responses',
      modelId: 'gpt-5-mini',
      apiKeyEnvVar: 'OPENAI_API_KEY'
    });
    const azureBridge = createAzureOpenAITeamProviderBridge({
      schemaId: 'atm.azureOpenAITeamProviderConfig.v1',
      providerId: 'azure-openai',
      sdkId: 'azure-openai-responses',
      endpointEnvVar: 'AZURE_OPENAI_ENDPOINT',
      deploymentName: 'atm-team-runtime',
      modelId: 'gpt-5-mini',
      authMode: 'managed-identity',
      tenantIdEnvVar: 'AZURE_TENANT_ID'
    });
    assert.equal(openaiBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(azureBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(openaiBridge.configValidation.ok, true);
    assert.equal(azureBridge.configValidation.ok, true);
    assert.ok(openaiBridge.metadata.supportedRuntimeModes.includes('real-agent'));
    assert.ok(azureBridge.metadata.supportedRuntimeModes.includes('real-agent'));

    const policy = createDefaultTeamPermissionPolicy();
    const httpCalls: any[] = [];
    const fakeHttpExecutor = async (request: any) => {
      httpCalls.push(request);
      return {
        ok: true,
        statusCode: 200,
        outputText: 'provider execution completed',
        outputArtifacts: ['agent-report', 'evidence-summary', 'provider-output'],
        retryable: false,
        summary: 'fake vendor API completed',
        executionMode: 'vendor-api' as const
      };
    };
    const openaiRun = await launchOpenAITeamProviderRun({
      bridge: openaiBridge,
      request: {
        taskId: 'TASK-TEAM-0042',
        role: 'implementer',
        runtimeMode: 'real-agent',
        providerId: 'openai',
        sdkId: 'openai-responses',
        modelId: 'gpt-5-mini',
        input: 'Implement scoped provider execution.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/openai.ts'],
      executor: fakeHttpExecutor,
      env: { OPENAI_API_KEY: 'test-openai-key' },
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    const azureRun = await launchAzureOpenAITeamProviderRun({
      bridge: azureBridge,
      request: {
        taskId: 'TASK-TEAM-0042',
        role: 'implementer',
        runtimeMode: 'real-agent',
        providerId: 'azure-openai',
        sdkId: 'azure-openai-responses',
        modelId: 'gpt-5-mini',
        input: 'Validate Azure execution.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/azure-openai.ts'],
      executor: fakeHttpExecutor,
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_BEARER_TOKEN: 'test-azure-token',
        AZURE_TENANT_ID: 'tenant'
      },
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    const openaiMetadata = httpCalls[0]?.body?.metadata;
    assert.equal(openaiMetadata?.scopedPathCount, '1');
    assert.ok(Object.values(openaiMetadata ?? {}).every((value) => typeof value === 'string'));
    for (const run of [openaiRun, azureRun]) {
      assert.equal(run.schemaId, 'atm.teamProviderBridgeRunResult.v1');
      assert.equal(run.ok, true);
      assert.equal(run.artifact.schemaId, 'atm.teamProviderRunArtifact.v1');
      assert.equal(run.artifact.runtimeMode, 'real-agent');
      assert.equal(run.artifact.permissionDecision.ok, true);
      assert.equal(run.artifact.execution.mode, 'vendor-api');
      assert.equal(run.artifact.execution.statusCode, 200);
      assert.equal(run.artifact.execution.outputTextPreview, 'provider execution completed');
      assert.equal(run.artifact.redaction.rawSecretsLogged, false);
      assert.equal(run.artifact.observabilityEventCount, 3);
      assert.deepEqual(run.observabilityEvents.map((event) => event.eventType), [
        'session.start',
        'artifact.output',
        'session.complete'
      ]);
      assert.ok(run.observabilityEvents.every((event) => event.schemaId === 'atm.teamAgentObservabilityEvent.v1'));
      assert.ok(run.observabilityEvents.every((event) => event.redaction.rawSecretsLogged === false));
      assert.ok(run.observabilityEvents.every((event) => event.evidenceBoundary.rawSecretsAllowed === false));
    }
    assert.equal(openaiRun.artifact.artifactType, azureRun.artifact.artifactType);
    assert.equal(openaiRun.observabilityEvents[1]?.artifactType, azureRun.observabilityEvents[1]?.artifactType);
    assert.equal(httpCalls.length, 2);
    assert.equal(httpCalls[0].url, 'https://api.openai.com/v1/responses');
    assert.ok(httpCalls[0].headers.Authorization.startsWith('Bearer '));
    assert.ok(httpCalls[1].url.includes('/openai/deployments/atm-team-runtime/responses?api-version='));
    assert.ok(httpCalls[1].headers.Authorization.startsWith('Bearer '));

    const bridgeSummary = buildOpenAIFamilyRuntimeBridgeSummary();
    assert.equal(bridgeSummary.schemaId, 'atm.openAIFamilyRuntimeBridgeSummary.v1');
    assert.deepEqual(bridgeSummary.providerIds, ['openai', 'azure-openai']);
    assert.equal(bridgeSummary.sharedProviderInterface, 'atm.teamProviderContract.v1');
    assert.ok(bridgeSummary.brokerConflictVocabulary.includes('broker-conflict-blocked'));
    assert.ok(bridgeSummary.bridges.every((bridge) => bridge.rawSecretsLogged === false));

    const planResult = await runTeam(['plan', '--task', 'TASK-TEAM-0042', '--cwd', process.cwd(), '--json']);
    const planBridgeSummary = (planResult.evidence as any)?.teamPlan?.openAIFamilyRuntimeBridges;
    const findings = (planResult.evidence as any)?.teamPlan?.validation?.findings ?? [];
    const onlyBrokerAdmissionFinding = findings.length <= 1
      && findings.every((finding: any) => ['blocked-broker-cid-conflict', 'blocked-cid-conflict'].includes(finding?.code));
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating OpenAI bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.openAIFamilyRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['openai', 'azure-openai']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.openaiTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.azureOpenAITeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.teamProviderRunArtifact.v1'));
    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/core/src/team-runtime/providers/openai.ts'));
    assert.ok(atomMap.includes('packages/core/src/team-runtime/providers/azure-openai.ts'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#openai-azure-openai-bridges'));

    console.log('[validate-team-agents] ok (openai-azure-openai-bridges)');
    return;
  }

  if (taskCase === 'claude-gemini-bridges') {
    const incompleteClaude = validateClaudeCodeTeamProviderConfig({
      schemaId: 'atm.claudeCodeTeamProviderConfig.v1',
      providerId: 'claude-code',
      sdkId: 'claude-code-editor-subagent',
      modelId: '',
      editorCommand: '',
      roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1'
    });
    assert.equal(incompleteClaude.ok, false);
    assert.deepEqual(incompleteClaude.missingFields, ['modelId', 'editorCommand']);
    assert.equal(incompleteClaude.rawSecretsLogged, false);

    const incompleteGemini = validateGeminiTeamProviderConfig({
      schemaId: 'atm.geminiTeamProviderConfig.v1',
      providerId: 'gemini',
      sdkId: 'gemini-cli',
      modelId: '',
      cliCommand: '',
      roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1'
    });
    assert.equal(incompleteGemini.ok, false);
    assert.deepEqual(incompleteGemini.missingFields, ['modelId', 'cliCommand']);
    assert.equal(incompleteGemini.rawSecretsLogged, false);

    const claudeBridge = createClaudeCodeTeamProviderBridge({
      schemaId: 'atm.claudeCodeTeamProviderConfig.v1',
      providerId: 'claude-code',
      sdkId: 'claude-code-editor-subagent',
      modelId: 'claude-opus-4',
      editorCommand: 'claude',
      roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1'
    });
    const geminiBridge = createGeminiTeamProviderBridge({
      schemaId: 'atm.geminiTeamProviderConfig.v1',
      providerId: 'gemini',
      sdkId: 'gemini-cli',
      modelId: 'gemini-2.5-pro',
      cliCommand: 'gemini',
      roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1'
    });
    assert.equal(claudeBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(geminiBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(claudeBridge.configValidation.ok, true);
    assert.equal(geminiBridge.configValidation.ok, true);
    assert.ok(claudeBridge.metadata.supportedRuntimeModes.includes('editor-subagent'));
    assert.ok(geminiBridge.metadata.supportedRuntimeModes.includes('editor-subagent'));

    const policy = createDefaultTeamPermissionPolicy();
    const commandCalls: any[] = [];
    const fakeCommandExecutor = async (request: any) => {
      commandCalls.push(request);
      return {
        ok: true,
        statusCode: 0,
        outputText: 'editor execution completed',
        outputArtifacts: ['agent-report', 'evidence-summary', 'provider-output'],
        retryable: false,
        summary: 'fake command completed',
        executionMode: 'editor-cli' as const
      };
    };
    const claudeRun = await launchClaudeCodeTeamProviderRun({
      bridge: claudeBridge,
      request: {
        taskId: 'TASK-TEAM-0043',
        role: 'implementer',
        runtimeMode: 'editor-subagent',
        providerId: 'claude-code',
        sdkId: 'claude-code-editor-subagent',
        modelId: 'claude-opus-4',
        instructions: 'Run bounded Claude role.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/claude-code.ts'],
      permissionLeases: ['exec.validator'],
      executor: fakeCommandExecutor,
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    const geminiRun = await launchGeminiTeamProviderRun({
      bridge: geminiBridge,
      request: {
        taskId: 'TASK-TEAM-0043',
        role: 'validator',
        runtimeMode: 'editor-subagent',
        providerId: 'gemini',
        sdkId: 'gemini-cli',
        modelId: 'gemini-2.5-pro',
        instructions: 'Run bounded Gemini role.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/gemini.ts'],
      permissionLeases: ['exec.validator'],
      executor: fakeCommandExecutor,
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    for (const run of [claudeRun, geminiRun]) {
      assert.equal(run.schemaId, 'atm.teamProviderBridgeRunResult.v1');
      assert.equal(run.ok, true);
      assert.equal(run.artifact.schemaId, 'atm.teamProviderRunArtifact.v1');
      assert.equal(run.artifact.runtimeMode, 'editor-subagent');
      assert.equal(run.artifact.roleEnvelope.schemaId, 'atm.teamEditorSubagentRoleEnvelope.v1');
      assert.equal(run.artifact.roleEnvelope.coordinatorOwnedAuthority, true);
      assert.ok(run.artifact.roleEnvelope.allowedFiles.length > 0);
      assert.ok(run.artifact.roleEnvelope.brokerConflictVocabulary.includes('broker-conflict-blocked'));
      assert.equal(run.artifact.permissionDecision.ok, true);
      assert.equal(run.artifact.execution.mode, 'editor-cli');
      assert.equal(run.artifact.execution.statusCode, 0);
      assert.equal(run.artifact.execution.outputTextPreview, 'editor execution completed');
      assert.equal(run.artifact.redaction.rawSecretsLogged, false);
      assert.equal(run.artifact.observabilityEventCount, 3);
      assert.deepEqual(run.observabilityEvents.map((event) => event.eventType), [
        'session.start',
        'artifact.output',
        'session.complete'
      ]);
      assert.ok(run.observabilityEvents.every((event) => event.schemaId === 'atm.teamAgentObservabilityEvent.v1'));
      assert.ok(run.observabilityEvents.every((event) => event.redaction.rawSecretsLogged === false));
      assert.ok(run.observabilityEvents.every((event) => event.evidenceBoundary.rawSecretsAllowed === false));
    }
    assert.equal(claudeRun.artifact.artifactType, geminiRun.artifact.artifactType);
    assert.equal(claudeRun.artifact.roleEnvelope.executionSurface, 'editor-subagent');
    assert.equal(geminiRun.artifact.roleEnvelope.executionSurface, 'cli-style');
    assert.equal(commandCalls.length, 2);
    assert.equal(commandCalls[0].command, 'claude');
    assert.deepEqual(commandCalls[0].args, ['--model', 'claude-opus-4', '--print']);
    assert.equal(commandCalls[1].command, 'gemini');
    assert.deepEqual(commandCalls[1].args, ['--model', 'gemini-2.5-pro']);
    assert.ok(commandCalls.every((call) => JSON.parse(call.stdin).coordinatorOwnedAuthority === true));

    const bridgeSummary = buildEditorExecutionRuntimeBridgeSummary();
    assert.equal(bridgeSummary.schemaId, 'atm.editorExecutionRuntimeBridgeSummary.v1');
    assert.deepEqual(bridgeSummary.providerIds, ['claude-code', 'gemini']);
    assert.equal(bridgeSummary.sharedProviderInterface, 'atm.teamProviderContract.v1');
    assert.equal(bridgeSummary.roleEnvelopeSchemaId, 'atm.teamEditorSubagentRoleEnvelope.v1');
    assert.ok(bridgeSummary.brokerConflictVocabulary.includes('broker-conflict-blocked'));
    assert.ok(bridgeSummary.bridges.every((bridge) => bridge.rawSecretsLogged === false));

    const planResult = await runTeam(['plan', '--task', 'TASK-TEAM-0043', '--cwd', process.cwd(), '--json']);
    const planBridgeSummary = (planResult.evidence as any)?.teamPlan?.editorExecutionRuntimeBridges;
    const findings = (planResult.evidence as any)?.teamPlan?.validation?.findings ?? [];
    const onlyBrokerAdmissionFinding = findings.length <= 1
      && findings.every((finding: any) => ['blocked-broker-cid-conflict', 'blocked-cid-conflict'].includes(finding?.code));
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating Claude/Gemini bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.editorExecutionRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['claude-code', 'gemini']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.claudeCodeTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.geminiTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.teamEditorSubagentRoleEnvelope.v1'));
    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/core/src/team-runtime/providers/claude-code.ts'));
    assert.ok(atomMap.includes('packages/core/src/team-runtime/providers/gemini.ts'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#claude-gemini-bridges'));

    console.log('[validate-team-agents] ok (claude-gemini-bridges)');
    return;
  }

  if (taskCase === 'microsoft-foundry-bridge') {
    const incompleteChat = validateMicrosoftFoundryTeamProviderConfig({
      schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1',
      providerId: 'microsoft-foundry',
      sdkId: 'microsoft-foundry',
      surface: 'project-chat-inference',
      modelId: 'gpt-5-mini',
      projectEndpointEnvVar: 'AZURE_AI_FOUNDRY_PROJECT_ENDPOINT',
      deploymentName: ''
    });
    assert.equal(incompleteChat.ok, false);
    assert.deepEqual(incompleteChat.missingFields, ['deploymentName']);
    assert.equal(incompleteChat.rawSecretsLogged, false);

    const incompleteAgent = validateMicrosoftFoundryTeamProviderConfig({
      schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1',
      providerId: 'microsoft-foundry',
      sdkId: 'microsoft-foundry',
      surface: 'agent-service',
      modelId: 'gpt-5-mini',
      projectEndpointEnvVar: 'AZURE_AI_FOUNDRY_PROJECT_ENDPOINT',
      agentIdEnvVar: ''
    });
    assert.equal(incompleteAgent.ok, false);
    assert.deepEqual(incompleteAgent.missingFields, ['agentIdEnvVar']);

    const chatConfig = {
      schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1' as const,
      providerId: 'microsoft-foundry' as const,
      sdkId: 'microsoft-foundry' as const,
      surface: 'project-chat-inference' as const,
      modelId: 'gpt-5-mini',
      projectEndpointEnvVar: 'AZURE_AI_FOUNDRY_PROJECT_ENDPOINT',
      deploymentName: 'team-runtime-chat',
      tenantIdEnvVar: 'AZURE_TENANT_ID'
    };
    const agentConfig = {
      schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1' as const,
      providerId: 'microsoft-foundry' as const,
      sdkId: 'microsoft-foundry' as const,
      surface: 'agent-service' as const,
      modelId: 'gpt-5-mini',
      projectEndpointEnvVar: 'AZURE_AI_FOUNDRY_PROJECT_ENDPOINT',
      agentIdEnvVar: 'AZURE_AI_FOUNDRY_AGENT_ID',
      tenantIdEnvVar: 'AZURE_TENANT_ID'
    };
    const chatBridge = createMicrosoftFoundryTeamProviderBridge(chatConfig);
    const agentBridge = createMicrosoftFoundryTeamProviderBridge(agentConfig);
    assert.equal(chatBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(agentBridge.schemaId, 'atm.teamProviderContract.v1');
    assert.equal(chatBridge.configValidation.ok, true);
    assert.equal(agentBridge.configValidation.ok, true);
    assert.equal(chatBridge.configValidation.surface, 'project-chat-inference');
    assert.equal(agentBridge.configValidation.surface, 'agent-service');
    assert.ok(chatBridge.metadata.supportedRuntimeModes.includes('real-agent'));
    assert.ok(agentBridge.metadata.supportedRuntimeModes.includes('real-agent'));

    const policy = createDefaultTeamPermissionPolicy();
    const foundryCalls: any[] = [];
    const fakeFoundryExecutor = async (request: any) => {
      foundryCalls.push(request);
      return {
        ok: true,
        statusCode: 200,
        outputText: 'foundry execution completed',
        outputArtifacts: ['agent-report', 'evidence-summary', 'provider-output'],
        retryable: false,
        summary: 'fake Foundry API completed',
        executionMode: 'vendor-api' as const
      };
    };
    const chatRun = await launchMicrosoftFoundryTeamProviderRun({
      bridge: chatBridge,
      config: chatConfig,
      request: {
        taskId: 'TASK-TEAM-0044',
        role: 'implementer',
        runtimeMode: 'real-agent',
        providerId: 'microsoft-foundry',
        sdkId: 'microsoft-foundry',
        modelId: 'gpt-5-mini',
        input: 'Run Foundry chat.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/microsoft-foundry.ts'],
      executor: fakeFoundryExecutor,
      env: {
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT: 'https://example.services.ai.azure.com',
        AZURE_AI_FOUNDRY_BEARER_TOKEN: 'test-foundry-token',
        AZURE_TENANT_ID: 'tenant'
      },
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    const agentRun = await launchMicrosoftFoundryTeamProviderRun({
      bridge: agentBridge,
      config: agentConfig,
      request: {
        taskId: 'TASK-TEAM-0044',
        role: 'validator',
        runtimeMode: 'real-agent',
        providerId: 'microsoft-foundry',
        sdkId: 'microsoft-foundry',
        modelId: 'gpt-5-mini',
        input: 'Run Foundry agent.'
      },
      permissionPolicy: policy,
      scopedPaths: ['packages/core/src/team-runtime/providers/microsoft-foundry.ts'],
      executor: fakeFoundryExecutor,
      env: {
        AZURE_AI_FOUNDRY_PROJECT_ENDPOINT: 'https://example.services.ai.azure.com',
        AZURE_AI_FOUNDRY_BEARER_TOKEN: 'test-foundry-token',
        AZURE_AI_FOUNDRY_AGENT_ID: 'agent-123',
        AZURE_TENANT_ID: 'tenant'
      },
      emittedAt: '2026-07-10T00:00:00.000Z'
    });
    for (const run of [chatRun, agentRun]) {
      assert.equal(run.schemaId, 'atm.teamProviderBridgeRunResult.v1');
      assert.equal(run.ok, true);
      assert.equal(run.providerId, 'microsoft-foundry');
      assert.equal(run.artifact.schemaId, 'atm.teamProviderRunArtifact.v1');
      assert.equal(run.artifact.runtimeMode, 'real-agent');
      assert.equal(run.artifact.permissionDecision.ok, true);
      assert.equal(run.artifact.execution.mode, 'vendor-api');
      assert.equal(run.artifact.execution.statusCode, 200);
      assert.equal(run.artifact.execution.outputTextPreview, 'foundry execution completed');
      assert.equal(run.artifact.redaction.rawSecretsLogged, false);
      assert.equal(run.artifact.observabilityEventCount, 3);
      assert.deepEqual(run.observabilityEvents.map((event) => event.eventType), [
        'session.start',
        'artifact.output',
        'session.complete'
      ]);
      assert.ok(run.observabilityEvents.every((event) => event.schemaId === 'atm.teamAgentObservabilityEvent.v1'));
      assert.ok(run.observabilityEvents.every((event) => event.redaction.rawSecretsLogged === false));
      assert.ok(run.observabilityEvents.every((event) => event.evidenceBoundary.rawSecretsAllowed === false));
    }
    assert.equal(chatRun.artifact.artifactType, agentRun.artifact.artifactType);
    assert.equal(chatRun.artifact.foundrySurface, 'project-chat-inference');
    assert.equal(agentRun.artifact.foundrySurface, 'agent-service');
    assert.equal(chatRun.artifact.foundryConfigRefs.deploymentName, 'team-runtime-chat');
    assert.equal(agentRun.artifact.foundryConfigRefs.agentIdEnvVar, 'AZURE_AI_FOUNDRY_AGENT_ID');
    assert.equal(foundryCalls.length, 2);
    assert.ok(foundryCalls[0].url.includes('/openai/deployments/team-runtime-chat/chat/completions?api-version='));
    assert.ok(foundryCalls[1].url.includes('/assistants/agent-123/messages?api-version='));
    assert.ok(foundryCalls.every((call) => call.headers.Authorization.startsWith('Bearer ')));

    const bridgeSummary = buildMicrosoftFoundryRuntimeBridgeSummary();
    assert.equal(bridgeSummary.schemaId, 'atm.microsoftFoundryRuntimeBridgeSummary.v1');
    assert.deepEqual(bridgeSummary.providerIds, ['microsoft-foundry']);
    assert.deepEqual(bridgeSummary.supportedSurfaces, ['project-chat-inference', 'agent-service']);
    assert.equal(bridgeSummary.sharedProviderInterface, 'atm.teamProviderContract.v1');
    assert.ok(bridgeSummary.brokerConflictVocabulary.includes('broker-conflict-blocked'));
    assert.ok(bridgeSummary.bridges.every((bridge) => bridge.rawSecretsLogged === false));

    const planResult = await runTeam(['plan', '--task', 'TASK-TEAM-0044', '--cwd', process.cwd(), '--json']);
    const planBridgeSummary = (planResult.evidence as any)?.teamPlan?.microsoftFoundryRuntimeBridges;
    const findings = (planResult.evidence as any)?.teamPlan?.validation?.findings ?? [];
    const onlyBrokerAdmissionFinding = findings.length <= 1
      && findings.every((finding: any) => ['blocked-broker-cid-conflict', 'blocked-cid-conflict'].includes(finding?.code));
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating Foundry bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.microsoftFoundryRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['microsoft-foundry']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.microsoftFoundryTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('project-chat-inference'));
    assert.ok(vendorRuntimeDoc.includes('agent-service'));
    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/core/src/team-runtime/providers/microsoft-foundry.ts'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#microsoft-foundry-bridge'));

    console.log('[validate-team-agents] ok (microsoft-foundry-bridge)');
    return;
  }

  if (taskCase === 'integration-capability-wiring') {
    const tempRoot = createTempWorkspace('atm-team-runtime-backend-');
    const manifestDir = path.join(tempRoot, '.atm', 'integrations');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(path.join(manifestDir, 'codex.manifest.json'), JSON.stringify({
      schemaId: 'atm.integrationInstallManifest.v1',
      adapterId: 'codex',
      adapterVersion: '0.0.0-test',
      installedAt: '2026-07-10T00:00:00.000Z',
      installedBy: 'validator',
      targetDir: 'integrations/codex-skills',
      metadata: {},
      files: [],
      teamRuntimeCapabilities: [
        {
          providerId: 'claude-code',
          runtimeModes: ['editor-subagent'],
          executionSurfaces: ['editor-subagent'],
          roles: ['implementer', 'validator'],
          status: 'experimental',
          evidence: 'validator fixture declares editor-subagent backend capability'
        }
      ]
    }, null, 2));

    const declaredReadiness = inspectTeamRuntimeBackendCapabilities(tempRoot);
    assert.equal(declaredReadiness.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
    assert.equal(declaredReadiness.declaredBackendCount, 1);
    assert.equal(declaredReadiness.startReadiness, 'runtime-backend-declared');
    assert.equal(declaredReadiness.capabilities[0]?.providerId, 'claude-code');
    assert.deepEqual(declaredReadiness.capabilities[0]?.runtimeModes, ['editor-subagent']);

    const repositoryReadiness = inspectTeamRuntimeBackendCapabilities(process.cwd());
    assert.equal(repositoryReadiness.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0045', '--cwd', process.cwd(), '--runtime-mode', 'editor-subagent', '--provider', 'claude-code', '--json']);
    assert.equal((validateResult.evidence as any)?.runtimeBackendReadiness?.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
    assert.equal((validateResult.evidence as any)?.runtimeContract?.runtimeMode, 'editor-subagent');
    assert.equal((validateResult.evidence as any)?.runtimeContract?.providerId, 'claude-code');

    const teamSource = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'team.ts'), 'utf8');
    assert.ok(teamSource.includes('ATM_TEAM_RUNTIME_BACKEND_MISSING'));
    assert.ok(teamSource.includes('Installed editor integrations are not runtime backends unless their manifest declares this capability.'));

    const onboarding = readFileSync(path.join(process.cwd(), 'docs', 'AGENT_PACK_ONBOARDING.md'), 'utf8');
    assert.ok(onboarding.includes('teamRuntimeCapabilities'));
    assert.ok(onboarding.includes('ATM_TEAM_RUNTIME_BACKEND_MISSING'));

    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/cli/src/commands/integration.ts#inspectTeamRuntimeBackendCapabilities'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#integration-capability-wiring'));

    console.log('[validate-team-agents] ok (integration-capability-wiring)');
    return;
  }

  if (taskCase === 'direct-provider-execute-admission') {
    const repoDefault = {
      repoDefault: {
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-5-mini',
        runtimeMode: 'broker-only' as const
      },
      roleOverrides: {}
    };
    const explicitRuntime = buildTeamRuntimeContract({
      runtimeMode: 'real-agent',
      providerId: 'anthropic',
      sdkId: 'anthropic-messages',
      modelId: 'claude-test',
      selectionConfig: repoDefault
    });
    assert.equal(explicitRuntime.runtimeMode, 'real-agent');
    assert.equal(explicitRuntime.providerId, 'anthropic');
    assert.equal(explicitRuntime.modelId, 'claude-test');

    const roleOverrideRuntime = buildTeamRuntimeContract({
      runtimeMode: 'real-agent',
      providerId: 'openai',
      sdkId: 'responses',
      modelId: 'global-model',
      roleName: 'implementer',
      selectionConfig: {
        ...repoDefault,
        roleOverrides: {
          implementer: {
            providerId: 'anthropic',
            sdkId: 'anthropic-messages',
            modelId: 'role-model',
            runtimeMode: 'real-agent'
          }
        }
      }
    });
    assert.equal(roleOverrideRuntime.providerId, 'anthropic');
    assert.equal(roleOverrideRuntime.modelId, 'role-model');

    const cwd = createTempWorkspace('atm-direct-provider-admission-');
    initializeGitRepository(cwd);
    const readiness = inspectTeamRuntimeBackendCapabilities(cwd);
    assert.deepEqual(readiness.capabilities.map((entry) => entry.providerId).sort(), [...TEAM_DIRECT_API_PROVIDER_IDS].sort());
    assert.ok(readiness.capabilities.every((entry) => entry.manifestPath === 'builtin:team-provider-contract'));
    assert.equal(readiness.startReadiness, 'runtime-backend-declared');

    const taskId = 'TASK-TEAM-DIRECT-EXECUTE';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: 'Direct provider execute admission fixture',
      status: 'running',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['docs/direct-provider-report.md'],
      deliverables: ['docs/direct-provider-report.md'],
      validators: ['validator']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, 'docs', 'direct-provider-report.md'), '# Fixture\n', 'utf8');

    const zeroExecution = await runTeam(['start', '--task', taskId, '--actor', 'validator', '--cwd', cwd, '--execute', '--json']);
    assert.equal(zeroExecution.ok, false);
    assert.ok(zeroExecution.messages.some((entry) => entry.code === 'ATM_TEAM_EXECUTION_BLOCKED'));
    assert.equal((zeroExecution.evidence as any)?.providerOrchestration?.results?.length, 0);

    const undeclaredEditorBackend = await runTeam([
      'start', '--task', taskId, '--actor', 'validator', '--cwd', cwd,
      '--runtime-mode', 'editor-subagent', '--provider', 'claude-code',
      '--role-provider', 'coordinator=claude-code:claude-test:claude-code:editor-subagent', '--json'
    ]);
    assert.equal(undeclaredEditorBackend.ok, false);
    assert.ok(undeclaredEditorBackend.messages.some((entry) => entry.code === 'ATM_TEAM_RUNTIME_BACKEND_MISSING'));

    console.log('[validate-team-agents] ok (direct-provider-execute-admission)');
    return;
  }

  if (taskCase === 'direct-provider-scoped-path-forwarding') {
    const scopedPaths = ['packages/cli/src/commands/team.ts'];
    const requests: Array<{ url: string; body: unknown }> = [];
    const executor = async (input: { url: string; body: unknown }) => {
      requests.push(input);
      return {
        ok: true,
        statusCode: 200,
        outputText: input.url.includes('anthropic')
          ? JSON.stringify({ content: [{ type: 'text', text: 'anthropic role complete' }] })
          : JSON.stringify({ output_text: 'openai role complete' }),
        outputArtifacts: [],
        retryable: false,
        summary: 'deterministic provider response',
        executionMode: 'vendor-api' as const
      };
    };
    for (const providerId of ['openai', 'anthropic'] as const) {
      const result = await runDirectTeamProviderRole({
        taskId: 'TASK-TEAM-0068',
        role: providerId === 'openai' ? 'reviewAgent' : 'implementer',
        selection: {
          providerId,
          sdkId: providerId === 'openai' ? 'openai-responses' : 'anthropic-messages',
          modelId: `${providerId}-test-model`,
          runtimeMode: 'real-agent'
        },
        env: {
          OPENAI_API_KEY: 'test-openai-key',
          ANTHROPIC_API_KEY: 'test-anthropic-key'
        },
        scopedPaths,
        executor
      });
      assert.equal(result?.ok, true);
    }
    assert.equal(requests.length, 2);

    console.log('[validate-team-agents] ok (direct-provider-scoped-path-forwarding)');
    return;
  }

  if (taskCase === 'three-vendor-direct-artifact-handoff' || taskCase === 'gemini-direct-api-bridge') {
    const calls: Array<{ url: string; body: any }> = [];
    const executor = async (input: { url: string; body: any }) => {
      calls.push(input);
      const serialized = JSON.stringify(input.body);
      if (serialized.includes('scopeGuardian')) {
        return { ok: false, statusCode: 409, outputText: 'broker-conflict-blocked', outputArtifacts: [], retryable: false, summary: 'broker-conflict-blocked', executionMode: 'vendor-api' as const };
      }
      const role = serialized.match(/role ([A-Za-z]+)/)?.[1] ?? 'unknown';
      const report = `${role} governed output VC-${role}`;
      const outputText = input.url.includes('anthropic')
        ? JSON.stringify({ content: [{ type: 'text', text: report }] })
        : input.url.includes('generativelanguage')
          ? JSON.stringify({ candidates: [{ content: { parts: [{ text: report }] } }] })
          : JSON.stringify({ output_text: report });
      return { ok: true, statusCode: 200, outputText, outputArtifacts: ['agent-report'], retryable: false, summary: 'deterministic provider response', executionMode: 'vendor-api' as const };
    };
    const selections = [
      { role: 'coordinator', selectedProvider: { providerId: 'gemini-direct', sdkId: 'gemini-generate-content', modelId: 'gemini-test', runtimeMode: 'real-agent' as const } },
      { role: 'implementer', selectedProvider: { providerId: 'anthropic', sdkId: 'anthropic-messages', modelId: 'claude-test', runtimeMode: 'real-agent' as const } },
      { role: 'scopeGuardian', selectedProvider: { providerId: 'openai', sdkId: 'openai-responses', modelId: 'gpt-test', runtimeMode: 'real-agent' as const } },
      { role: 'reviewAgent', selectedProvider: { providerId: 'openai', sdkId: 'openai-responses', modelId: 'gpt-test', runtimeMode: 'real-agent' as const } }
    ];
    const run = await runTeamProviderExecution({
      cwd: process.cwd(), taskId: 'TASK-TEAM-0071', teamRunId: 'team-three-vendor-test',
      recipe: { schemaId: 'atm.teamRecipe.v1', recipeId: 'fixture', agents: [] },
      runtimeContract: { runtimeMode: 'real-agent' } as any,
      runtimePilot: {} as any, roleSelections: selections,
      scopedPaths: ['packages/cli/src/commands/team.ts'], executor
    });
    assert.equal(run.results.length, 4);
    assert.equal(run.results.filter((result) => result.ok).length, 3);
    assert.equal(run.results[2].ok, false);
    assert.ok(run.results[3].contextTelemetry.priorArtifactCount >= 2);
    assert.ok(run.results[3].contextTelemetry.consumedArtifactRefs.includes('implementer/anthropic'));
    const reviewerCall = calls[3];
    assert.ok(JSON.stringify(reviewerCall.body).includes('[implementer/anthropic]'));
    assert.ok(JSON.stringify(reviewerCall.body).includes('implementer governed output'));
    assert.ok(run.results[3].contextTelemetry.handoffChars <= 2401);

    for (const providerId of ['openai', 'anthropic', 'gemini-direct'] as const) {
      const result = await runDirectTeamProviderRole({
        taskId: 'TASK-TEAM-0071', role: 'validator',
        selection: { providerId, sdkId: providerId, modelId: `${providerId}-cheap`, runtimeMode: 'real-agent' },
        env: { OPENAI_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture', GEMINI_API_KEY: 'fixture' },
        scopedPaths: ['packages/cli/src/commands/team.ts'], executor
      });
      assert.equal(result?.ok, true);
      assert.ok(result?.sessionId.includes(providerId));
    }
    const bounded = buildDirectTeamRoleInstructions({
      taskId: 'TASK-TEAM-0071', role: 'reviewAgent',
      priorRoleArtifacts: Array.from({ length: 8 }, (_, index) => ({ role: `role-${index}`, providerId: 'openai', outputTextPreview: 'x'.repeat(900) }))
    });
    assert.equal(bounded.telemetry.priorArtifactCount, 4);
    assert.ok(bounded.telemetry.handoffChars <= 2401);
    assert.equal(TEAM_PROVIDER_IDS.includes('gemini-direct'), true);
    assert.equal(TEAM_DIRECT_API_PROVIDER_IDS.includes('gemini-direct'), true);

    const bridge = createGeminiDirectTeamProviderBridge({ schemaId: 'atm.geminiDirectTeamProviderConfig.v1', providerId: 'gemini-direct', sdkId: 'gemini-generate-content', modelId: 'gemini-test', apiKeyEnvVar: 'GEMINI_API_KEY' });
    const bridgeRun = await launchGeminiDirectTeamProviderRun({ bridge, request: { taskId: 'TASK-TEAM-0071', role: 'validator', providerId: 'gemini-direct', sdkId: 'gemini-generate-content', modelId: 'gemini-test', runtimeMode: 'real-agent' }, permissionPolicy: createDefaultTeamPermissionPolicy(), scopedPaths: ['packages/cli/src/commands/team.ts'], env: { GEMINI_API_KEY: 'fixture' }, executor });
    assert.equal(bridgeRun.ok, true);
    assert.equal(bridgeRun.artifact.redaction.rawSecretsLogged, false);
    console.log(`[validate-team-agents] ok (${taskCase})`);
    return;
  }

  if (taskCase === 'broker-conflict-resolution') {
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

    console.log('[validate-team-agents] ok (broker-conflict-resolution)');
    return;
  }

  if (taskCase === 'broker-conflict-ux') {
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

    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#broker-conflict-ux'));
    assert.ok(atomMap.includes('schemas/team-agents/captain-decision.schema.json'));
    assert.ok(atomMap.includes('atm.brokerConflictUx.v1'));

    console.log('[validate-team-agents] ok (broker-conflict-ux)');
    return;
  }

  if (taskCase === 'broker-conflict-resolution-replay') {
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

    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('scripts/validate-mao-event-replay.ts#broker-conflict-resolution'));
    assert.ok(atomMap.includes('scripts/fixtures/mao-event-replay/broker-conflict-resolution.fixture.json'));

    console.log('[validate-team-agents] ok (broker-conflict-resolution-replay)');
    return;
  }

  if (taskCase === 'broker-override-gate-parity') {
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
          leaseEpoch: 1,
          leaseSeconds: 1800,
          leaseMaxSeconds: 1800,
          heartbeatAt: '2026-07-10T00:00:00.000Z',
          lane: 'direct-brokered',
          expiresAt: '2099-01-01T00:00:00.000Z'
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
          leaseEpoch: 1,
          leaseSeconds: 1800,
          leaseMaxSeconds: 1800,
          heartbeatAt: '2026-07-10T00:00:00.000Z',
          lane: 'direct-brokered',
          expiresAt: '2099-01-01T00:00:00.000Z'
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
    return;
  }

  if (taskCase === 'governed-repo-vendor-config') {
    const surface = discoverGovernedVendorConfigSurface(process.cwd());
    assert.equal(existsSync(surface.templateReadme), true);
    const selfHosting = readFileSync(path.join(process.cwd(), 'docs', 'SELF_HOSTING_ALPHA.md'), 'utf8');
    assert.ok(selfHosting.includes('agent-integrations/vendors'));
    console.log('[validate-team-agents] ok (governed-repo-vendor-config)');
    return;
  }

  if (taskCase === 'provider-selection-overrides') {
    const selection = resolveTeamProviderSelection('validator', {
      repoDefault: {
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-5-mini',
        runtimeMode: 'broker-only'
      },
      roleOverrides: {
        validator: {
          providerId: 'gemini',
          sdkId: 'gemini-cli',
          modelId: 'gemini-2.5-pro',
          runtimeMode: 'editor-subagent'
        }
      }
    });
    assert.equal(selection.source, 'role-override');
    const runtime = buildTeamRuntimeContract({
      roleName: 'validator',
      selectionConfig: {
        repoDefault: {
          providerId: 'openai',
          sdkId: 'responses',
          modelId: 'gpt-5-mini',
          runtimeMode: 'broker-only'
        },
        roleOverrides: {
          validator: {
            providerId: 'gemini',
            sdkId: 'gemini-cli',
            modelId: 'gemini-2.5-pro',
            runtimeMode: 'editor-subagent'
          }
        }
      }
    });
    assert.equal(runtime.providerId, 'gemini');
    assert.ok(runtime.selectionReason.includes('selection=role-override'));
    console.log('[validate-team-agents] ok (provider-selection-overrides)');
    return;
  }

  if (taskCase === 'per-role-provider-selection-config') {
    const selectionConfig = mergeTeamProviderSelectionConfig({
      repoConfig: {
        repoDefault: {
          providerId: 'openai',
          sdkId: 'responses',
          modelId: 'gpt-5-mini',
          runtimeMode: 'broker-only'
        },
        roleOverrides: {
          validator: {
            providerId: 'gemini',
            sdkId: 'gemini-cli',
            modelId: 'gemini-2.5-pro',
            runtimeMode: 'editor-subagent'
          }
        }
      },
      cliRoleOverrides: ['validator=claude-code:claude-sonnet:claude-code:editor-subagent']
    });
    const validatorSelection = resolveTeamProviderSelection('validator', selectionConfig);
    assert.equal(validatorSelection.providerId, 'claude-code');
    assert.equal(validatorSelection.modelId, 'claude-sonnet');
    assert.equal(validatorSelection.runtimeMode, 'editor-subagent');
    const readerSelection = resolveTeamProviderSelection('reader', selectionConfig);
    assert.equal(readerSelection.providerId, 'openai');
    assert.equal(readerSelection.modelId, 'gpt-5-mini');

    const task = {
      workItemId: 'TASK-TEAM-0051',
      title: 'Per-role provider config and L5 roster projection',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['npm run typecheck']
    };
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'atm.default.normal.typescript',
      language: 'typescript',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
        { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
        { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
        { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
      ]
    };
    const plan = buildTeamPlan({
      task,
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L5',
      providerSelectionConfig: selectionConfig,
      providerSelectionSource: {
        schemaId: 'atm.teamAgentsConfig.v1',
        path: '.atm/config/team-provider-selection.json',
        loaded: true,
        cliOverrideCount: 1
      }
    }) as any;
    assert.equal(plan.teamLevel, 'L5');
    assert.equal(plan.captainDecision.teamLevel, 'L5');
    assert.equal(plan.captainDecision.teamLevelSource, 'manual');
    assert.equal(plan.captainDecision.teamSize, 'large');
    assert.equal(plan.providerSelectionSource.loaded, true);
    assert.deepEqual(plan.rosterProjection.activeRoles, [
      'coordinator',
      'atomizationPlanner',
      'reader',
      'scopeGuardian',
      'implementer',
      'validator',
      'evidenceCollector',
      'lieutenant',
      'reviewAgent',
      'knowledgeScout'
    ]);
    assert.deepEqual(plan.rosterProjection.syntheticRoles, ['lieutenant', 'reviewAgent', 'knowledgeScout']);
    const validatorManifest = plan.roleSkillPackManifest.roles.find((entry: any) => entry.role === 'validator');
    assert.equal(validatorManifest.selectedProvider.providerId, 'claude-code');
    assert.equal(validatorManifest.selectedProvider.modelId, 'claude-sonnet');
    const l1Plan = buildTeamPlan({
      task,
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L1',
      providerSelectionConfig: selectionConfig
    }) as any;
    assert.equal(l1Plan.teamLevel, 'L1');
    assert.deepEqual(l1Plan.rosterProjection.activeRoles, ['coordinator', 'atomizationPlanner', 'implementer', 'validator']);
    const l4Plan = buildTeamPlan({
      task,
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L4',
      providerSelectionConfig: selectionConfig
    }) as any;
    assert.equal(l4Plan.teamLevel, 'L4');
    assert.deepEqual(l4Plan.rosterProjection.syntheticRoles, ['lieutenant']);
    assert.ok(l4Plan.rosterProjection.activeRoles.includes('lieutenant'));
    assert.ok(!l4Plan.rosterProjection.activeRoles.includes('reviewAgent'));
    assert.ok(!l4Plan.rosterProjection.activeRoles.includes('knowledgeScout'));
    assert.ok(plan.rosterProjection.activeRoles.includes('reviewAgent'));
    assert.ok(plan.rosterProjection.activeRoles.includes('knowledgeScout'));

    console.log('[validate-team-agents] ok (per-role-provider-selection-config)');
    return;
  }

  if (taskCase === 'team-governance-runtime-fields') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.governance-fields',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const allowedPlan = buildTeamPlan({
      task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L1'
    }) as any;
    assert.equal(allowedPlan.decisionClass, 'auto-execution');
    assert.equal(allowedPlan.violationStatus, 'none');
    assert.equal(allowedPlan.requiresHumanSignoff, false);
    assert.equal(allowedPlan.requiresAdr, false);
    const adrPlan = buildTeamPlan({
      task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: { ok: true, findings: [] },
      brokerLane: {
        ...safeBrokerLane(),
        decision: { verdict: 'needs-steward', reason: 'ADR required for steward lane.' },
        blockedReasons: ['ADR required for steward lane.']
      },
      requestedTeamSize: 'L1'
    }) as any;
    assert.equal(adrPlan.decisionClass, 'adr-required');
    assert.equal(adrPlan.violationStatus, 'adr-required');
    assert.equal(adrPlan.requiresHumanSignoff, true);
    assert.equal(adrPlan.requiresAdr, true);
    const blockedPlan = buildTeamPlan({
      task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
      recipe,
      writePaths: ['packages/cli/src/commands/team.ts'],
      validation: {
        ok: false,
        findings: [{
          level: 'error',
          code: 'ATM_TEAM_WRITE_SCOPE_EXCEEDED',
          summary: 'Write scope exceeded.',
          detail: 'file.write lease outside task scope.',
          suggestedFix: 'Narrow the lease.'
        }]
      },
      brokerLane: safeBrokerLane(),
      requestedTeamSize: 'L1'
    }) as any;
    assert.equal(blockedPlan.decisionClass, 'blocked');
    assert.equal(blockedPlan.violationStatus, 'blocked');
    assert.equal(blockedPlan.governanceRuntime.schemaId, 'atm.teamGovernanceRuntimeFields.v1');
    console.log('[validate-team-agents] ok (team-governance-runtime-fields)');
    return;
  }

  if (taskCase === 'review-agent-signature') {
    const signature = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0059',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
      reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-claude-sonnet' },
      reviewedDiffHash: 'sha256:reviewed-diff',
      policy: 'different-provider',
      findings: ['missing tests around close gate']
    });
    assert.equal(signature.schemaId, 'atm.reviewAgentSignature.v1');
    assert.equal(signature.signatureStatus, 'formal-signature');
    assert.equal(signature.permission, 'review.signature.write');
    assert.equal(signature.modelCertificationId, 'cert-claude-sonnet');
    assert.equal(signature.earlyWarning[0].category, 'missing-tests');
    const advisory = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0059',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
      reviewer: { providerId: 'openai', modelId: 'gpt-5-mini' },
      reviewedDiffHash: 'sha256:reviewed-diff',
      policy: 'different-provider'
    });
    assert.equal(advisory.signatureStatus, 'advisory-note');
    assert.equal(advisory.permission, null);
    console.log('[validate-team-agents] ok (review-agent-signature)');
    return;
  }

  if (taskCase === 'reviewer-independence-early-warning') {
    assert.equal(evaluateReviewerIndependence({
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
      reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
      policy: 'different-provider'
    }).ok, true);
    assert.equal(evaluateReviewerIndependence({
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
      reviewer: { providerId: 'openai', modelId: 'gpt-5-large', modelCertificationId: 'cert-b' },
      policy: 'different-provider'
    }).ok, false);
    assert.equal(evaluateReviewerIndependence({
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
      reviewer: { providerId: 'openai', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
      policy: 'different-model-family'
    }).ok, true);
    assert.equal(evaluateReviewerIndependence({
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
      reviewer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-b' },
      policy: 'different-certification'
    }).ok, true);
    const signature = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0060',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
      reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
      reviewedDiffHash: 'sha256:early-warning',
      policy: 'different-provider',
      findings: ['scope drift in generated file', 'rollback gap missing']
    });
    assert.deepEqual(signature.earlyWarning.map((entry: any) => entry.category), ['scope-drift', 'rollback-gap']);
    console.log('[validate-team-agents] ok (reviewer-independence-early-warning)');
    return;
  }

  if (taskCase === 'multi-signature-quorum') {
    const formalA = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0061',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
      reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-claude-sonnet' },
      reviewedDiffHash: 'sha256:quorum',
      policy: 'different-provider',
      findings: ['approve']
    });
    const advisory = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0061',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
      reviewer: { providerId: 'openai', modelId: 'gpt-5-mini' },
      reviewedDiffHash: 'sha256:quorum',
      policy: 'different-provider',
      findings: ['approve']
    });
    const insufficient = evaluateReviewQuorum({ signatures: [formalA, advisory], requiredFormalSignatures: 2 });
    assert.equal(insufficient.ok, false);
    assert.equal(insufficient.formalSignatureCount, 1);
    assert.equal(insufficient.escalationTarget, 'Coordinator/Captain/human review');
    const formalB = buildReviewAgentSignature({
      taskId: 'TASK-TEAM-0061',
      implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
      reviewer: { providerId: 'gemini', modelId: 'gemini-pro', modelCertificationId: 'cert-gemini-pro' },
      reviewedDiffHash: 'sha256:quorum',
      policy: 'different-provider',
      findings: ['approve']
    });
    assert.equal(evaluateReviewQuorum({ signatures: [formalA, formalB], requiredFormalSignatures: 2 }).ok, true);
    const conflict = evaluateReviewQuorum({
      signatures: [formalA, { ...formalB, findings: ['block'] }],
      requiredFormalSignatures: 2
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflicts.length, 1);
    console.log('[validate-team-agents] ok (multi-signature-quorum)');
    return;
  }

  if (taskCase === 'provider-neutral-role-skill-pack-manifest') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.provider-neutral-manifest',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
        { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
      ]
    };
    const manifest = buildProviderNeutralRoleSkillPackManifest({
      recipe,
      selectionConfig: {
        repoDefault: {
          providerId: 'openai',
          sdkId: 'responses',
          modelId: 'gpt-5-mini',
          runtimeMode: 'broker-only'
        },
        roleOverrides: {
          validator: {
            providerId: 'gemini',
            sdkId: 'gemini-cli',
            modelId: 'gemini-2.5-pro',
            runtimeMode: 'editor-subagent'
          }
        }
      }
    });
    assert.equal(manifest.schemaId, 'atm.teamRoleSkillPackManifest.v1');
    assert.equal(manifest.providerNeutral, true);
    assert.equal(manifest.discoveryMode, 'capability-driven');
    assert.equal(manifest.roleFirstProviderSecond, true);
    assert.deepEqual(manifest.sharedVocabulary.brokerConflict, [
      'decisionClass',
      'decisionReason',
      'violationStatus',
      'broker-conflict-blocked'
    ]);
    assert.equal(manifest.roles.length, recipe.agents.length);
    assert.ok(manifest.roles.every((role) => role.permissionLease.alignment === 'role-first'));
    assert.ok(manifest.roles.every((role) => role.providerCapabilities.length === TEAM_PROVIDER_IDS.length));
    assert.ok(manifest.roles.every((role) => role.providerCapabilities.every((provider) => provider.satisfiesRolePack)));
    const coordinator = manifest.roles.find((role) => role.role === 'coordinator');
    assert.ok(coordinator);
    assert.ok(coordinator?.capabilityTags.includes('lifecycle-authority'));
    assert.deepEqual(coordinator?.permissionLease.forbiddenPermissions, []);
    const implementer = manifest.roles.find((role) => role.role === 'implementer');
    assert.ok(implementer?.permissionLease.allowedPermissions.includes('file.write'));
    assert.ok(implementer?.permissionLease.forbiddenPermissions.includes('git.write'));
    assert.ok(implementer?.permissionLease.forbiddenPermissions.includes('task.lifecycle'));
    const validator = manifest.roles.find((role) => role.role === 'validator');
    assert.equal(validator?.selectedProvider.providerId, 'gemini');
    assert.equal(validator?.selectedProvider.source, 'role-override');
    assert.ok(validator?.providerCapabilities.some((provider) => provider.providerId === 'microsoft-foundry'));

    const planResult = await runTeam(['plan', '--task', 'TASK-SKL-0010', '--cwd', process.cwd(), '--json']);
    const planManifest = (planResult.evidence as any)?.teamPlan?.roleSkillPackManifest;
    assert.equal(planResult.ok, true);
    assert.equal(planManifest?.schemaId, 'atm.teamRoleSkillPackManifest.v1');
    assert.equal(planManifest?.roleFirstProviderSecond, true);
    assert.deepEqual(planManifest?.sharedVocabulary?.brokerConflict, manifest.sharedVocabulary.brokerConflict);

    const roleContractDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'role-skill-pack-contract.md'), 'utf8');
    assert.ok(roleContractDoc.includes('atm.teamRoleSkillPackManifest.v1'));
    assert.ok(roleContractDoc.includes('roleFirstProviderSecond'));
    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('capability-driven'));
    assert.ok(vendorRuntimeDoc.includes('atm.teamRoleSkillPackManifest.v1'));

    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/cli/src/commands/team.ts#buildProviderNeutralRoleSkillPackManifest'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#provider-neutral-role-skill-pack-manifest'));

    console.log('[validate-team-agents] ok (provider-neutral-role-skill-pack-manifest)');
    return;
  }

  if (taskCase === 'cross-vendor-observability') {
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
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating observability wiring');
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
    const atomMap = readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8');
    assert.ok(atomMap.includes('packages/core/src/team-runtime/observability.ts'));
    assert.ok(atomMap.includes('schemas/governance/team-agent-observability-event.schema.json'));
    assert.ok(atomMap.includes('scripts/validate-team-agents.ts#cross-vendor-observability'));

    console.log('[validate-team-agents] ok (cross-vendor-observability)');
    return;
  }

  if (taskCase === 'real-observability-query') {
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
    return;
  }

  if (taskCase === 'broker-run-scan-index') {
    assertBrokerRunScanIndex();
    console.log('[validate-team-agents] ok (broker-run-scan-index)');
    return;
  }

  if (taskCase === 'file-write-scope') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.file-write-scope',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const allowedWritePaths = [
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts'
    ];

    const validLease = validateTeamPermissionModel(recipe, ['packages\\cli\\src\\commands\\team.ts'], { allowedWritePaths });
    assert.equal(validLease.ok, true);
    assert.equal(validLease.findings.length, 0);

    const outOfBounds = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/next.ts'], { allowedWritePaths });
    assert.equal(outOfBounds.ok, false);
    const outOfBoundsFinding = outOfBounds.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS');
    assert.ok(outOfBoundsFinding);
    assert.ok(outOfBoundsFinding?.detail.includes('packages/cli/src/commands/next.ts'));
    assert.deepEqual(outOfBoundsFinding?.paths, ['packages/cli/src/commands/next.ts']);
    assert.ok(outOfBoundsFinding?.suggestedFix.includes('scope amendment'));

    const traversal = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/../next.ts'], { allowedWritePaths });
    assert.equal(traversal.ok, false);
    const traversalFinding = traversal.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL');
    assert.ok(traversalFinding);
    assert.ok(traversalFinding?.detail.includes('packages/cli/src/commands/../next.ts'));

    const runtimePath = validateTeamPermissionModel(recipe, ['.atm/runtime/team-runs/example.json'], {
      allowedWritePaths: ['.atm/runtime/team-runs/example.json']
    });
    assert.equal(runtimePath.ok, false);
    const runtimeFinding = runtimePath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
    assert.ok(runtimeFinding);
    assert.ok(runtimeFinding?.detail.includes('.atm/runtime/team-runs/example.json'));

    const historyPath = validateTeamPermissionModel(recipe, ['.atm/history/tasks/TASK-TEAM-0013.json'], {
      allowedWritePaths: ['.atm/history/tasks/TASK-TEAM-0013.json']
    });
    assert.equal(historyPath.ok, false);
    const historyFinding = historyPath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
    assert.ok(historyFinding);
    assert.ok(historyFinding?.detail.includes('.atm/history/tasks/TASK-TEAM-0013.json'));

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0013', '--cwd', process.cwd(), '--json']);
    const evidence = validateResult.evidence as any;
    assert.equal(validateResult.ok, true);
    assert.equal(evidence?.action, 'validate');
    assert.equal(evidence?.validation?.ok, true);
    assert.ok(Array.isArray(evidence?.validation?.findings));
    assert.ok(evidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write'));

    console.log('[validate-team-agents] ok (file-write-scope)');
    return;
  }

  if (taskCase === 'fencing-deadlock') {
    const runModes: ScopeLeaseRunMode[] = ['real-agent', 'editor-subagent', 'broker-only'];
    for (const runMode of runModes) {
      const duplicateOwner = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-a`, runMode, owner: { instanceId: 'agent-a', worktreeId: 'wt-a' } }),
        scopeLease({ leaseId: `${runMode}-b`, runMode, owner: { instanceId: 'agent-b', worktreeId: 'wt-b' } })
      ]);
      assert.equal(duplicateOwner.ok, false);
      assert.ok(duplicateOwner.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_DUPLICATE_EXCLUSIVE_OWNER'));

      const staleEpoch = validateScopeLeaseEpoch({
        leaseId: `${runMode}-epoch`,
        runMode,
        expectedEpoch: 20,
        actualEpoch: 19
      });
      assert.equal(staleEpoch.ok, false);
      const staleFinding = staleEpoch.findings.find((finding) => finding.code === 'ATM_SCOPE_LEASE_STALE_EPOCH');
      assert.equal(staleFinding?.expectedEpoch, 20);
      assert.equal(staleFinding?.actualEpoch, 19);

      const cycle = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-cycle-a`, runMode, resourceKey: 'src/a.ts', waitsFor: [`${runMode}-cycle-b`] }),
        scopeLease({ leaseId: `${runMode}-cycle-b`, runMode, resourceKey: 'src/b.ts', waitsFor: [`${runMode}-cycle-a`] })
      ]);
      assert.equal(cycle.ok, false);
      assert.ok(cycle.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_WAIT_FOR_CYCLE'));

      const tombstone = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-released`, runMode, status: 'released', leaseEpoch: 10 }),
        scopeLease({ leaseId: `${runMode}-reacquire`, runMode, leaseEpoch: 10 })
      ]);
      assert.equal(tombstone.ok, false);
      assert.ok(tombstone.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_TOMBSTONE_REACQUIRE'));
    }

    const acyclic = validateScopeLeaseFencing([
      scopeLease({ leaseId: 'acyclic-a', resourceKey: 'src/a.ts', waitsFor: ['acyclic-b'] }),
      scopeLease({ leaseId: 'acyclic-b', resourceKey: 'src/b.ts' })
    ]);
    assert.equal(acyclic.ok, true);

    const outsideAllowedFiles = validateScopeLeaseFencing([
      scopeLease({
        leaseId: 'outside-scope',
        allowedFiles: ['packages/cli/src/commands/team.ts'],
        writeSet: ['packages/cli/src/commands/next.ts']
      })
    ]);
    assert.equal(outsideAllowedFiles.ok, false);
    assert.ok(outsideAllowedFiles.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_ALLOWED_FILES_VIOLATION'));

    console.log('[validate-team-agents] ok (fencing-deadlock)');
    return;
  }

  if (taskCase === 'active-resource-index-readonly') {
    const beforeStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
    const beforeEvidence = beforeStatus.evidence as any;
    const plan = await runTeam(['plan', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
    const validate = await runTeam(['validate', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
    const afterStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
    const afterEvidence = afterStatus.evidence as any;

    assert.equal(plan.ok, true);
    assert.equal(validate.ok, true);
    assert.equal(beforeEvidence?.teamRunCount, afterEvidence?.teamRunCount);
    assert.equal((plan.evidence as any)?.runtimeWritten, false);
    assert.equal((validate.evidence as any)?.runtimeWritten, false);
    assert.equal((plan.evidence as any)?.agentsSpawned, false);
    assert.equal((validate.evidence as any)?.agentsSpawned, false);
    assert.equal((plan.evidence as any)?.teamPlan?.brokerLane?.safeToStart, true);

    console.log('[validate-team-agents] ok (active-resource-index-readonly)');
    return;
  }

  if (taskCase === 'planning-path-lease-normalization') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.planning-path-lease-normalization',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const repoRoot = process.cwd();
    const targetAbsolute = path.join(repoRoot, 'packages/cli/src/commands/team.ts');
    const targetRelative = 'packages/cli/src/commands/team.ts';
    const planningAbsolute = 'C:/Users/User/3KLife/docs/ai_atomic_framework/team-agents/tasks/TASK-TEAM-0030.task.md';

    const targetRepoLease = validateTeamPermissionModel(recipe, [targetAbsolute], {
      allowedWritePaths: [targetRelative],
      repoRoot
    });
    assert.equal(targetRepoLease.ok, true);
    assert.equal(targetRepoLease.findings.length, 0);

    const planningRepoLease = validateTeamPermissionModel(recipe, [planningAbsolute], {
      allowedWritePaths: [targetRelative],
      repoRoot
    });
    assert.equal(planningRepoLease.ok, false);
    assert.ok(planningRepoLease.findings.some((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'));

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0030', '--recipe', 'atm.default.normal.typescript', '--cwd', repoRoot, '--json']);
    const validateEvidence = validateResult.evidence as any;
    const validateFindings = validateEvidence?.validation?.findings ?? [];
    assert.equal(validateResult.ok, true);
    assert.equal(validateEvidence?.validation?.ok, true);
    assert.equal(validateFindings.some((finding: any) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'), false);
    assert.equal(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.some((entry: string) => entry.includes('3KLife'))), false);
    assert.ok(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.includes(targetRelative)));

    console.log('[validate-team-agents] ok (planning-path-lease-normalization)');
    return;
  }

  if (taskCase === 'start-status') {
    const cwd = createTempWorkspace('atm-team-start-status-');
    initializeGitRepository(cwd);
    const taskId = 'TASK-TEAM-0011';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: 'Team start/status runtime',
      status: 'running',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case start-status'],
      atomizationImpact: { ownerAtomOrMap: 'atm.team-agents-map' }
    }, null, 2)}\n`, 'utf8');
    mkdirSync(path.join(cwd, 'packages', 'cli', 'src', 'commands'), { recursive: true });
    writeFileSync(path.join(cwd, 'packages', 'cli', 'src', 'commands', 'team.ts'), 'export const teamStartStatusFixture = true;\n', 'utf8');
    const start = await runTeam(['start', '--task', taskId, '--actor', 'codex-main', '--cwd', cwd, '--json']);
    const startEvidence = start.evidence as any;
    assert.equal(start.ok, true);
    assert.equal(startEvidence?.action, 'start');
    assert.equal(startEvidence?.runtimeWritten, true);
    assert.equal(startEvidence?.agentsSpawned, false);
    assert.match(startEvidence?.teamRunPath, /^\.atm\/runtime\/team-runs\/team-[a-f0-9]{12}\.json$/);

    const teamRun = startEvidence?.teamRun;
    assert.equal(teamRun?.schemaId, 'atm.teamRun.v1');
    assert.match(teamRun?.teamRunId, /^team-[a-f0-9]{12}$/);
    assert.equal(teamRun?.taskId, taskId);
    assert.equal(teamRun?.actorId, 'codex-main');
    assert.equal(teamRun?.recipeId, 'atm.default.normal.typescript');
    assert.equal(teamRun?.status, 'active');
    assert.equal(teamRun?.executionMode, 'manual-team');
    assert.equal(teamRun?.agentsSpawned, false);
    assert.equal(teamRun?.runtimeWritten, true);
    assert.equal(teamRun?.brokerSubagent?.schemaId, 'atm.teamBrokerSubagentContract.v1');
    assert.equal(teamRun?.brokerSubagent?.enabled, true);
    assert.equal(teamRun?.brokerSubagent?.decisionSurface, 'brokerLane');
    assert.equal(teamRun?.brokerSubagent?.stewardId, 'neutral-write-steward');
    assert.equal(teamRun?.runtimeContract?.brokerSubagent?.schemaId, teamRun?.brokerSubagent?.schemaId);
    assert.equal(teamRun?.runtimeContract?.brokerSubagent?.subagentId, teamRun?.brokerSubagent?.subagentId);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.schemaId, 'atm.teamBrokerGovernanceSummary.v1');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerSubagentEnabled, true);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerDecisionSurface, 'brokerLane');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerStewardId, 'neutral-write-steward');
    assert.deepEqual(teamRun?.teamSummary?.brokerGovernance?.brokerGoverns, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.commitLaneSerializedBy, 'branch-commit-queue');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerGitWrite, false);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerTaskLifecycle, false);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerSelfClose, false);
    assert.ok(Array.isArray(teamRun?.roles) && teamRun.roles.length > 0);
    assert.ok(Array.isArray(teamRun?.leases) && teamRun.leases.length > 0);
    assert.deepEqual(teamRun?.leases, teamRun?.permissionLeases);
    assert.ok(teamRun.roles.some((role: any) => role.agentId === 'coordinator' && role.role === 'coordinator'));
    assert.ok(teamRun.leases.some((lease: any) => lease.permission === 'file.write' && Array.isArray(lease.paths)));
    assert.match(teamRun?.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(teamRun?.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const status = await runTeam(['status', '--compact', '--cwd', cwd, '--json']);
    const statusEvidence = status.evidence as any;
    assert.equal(status.ok, true);
    assert.equal(statusEvidence?.action, 'status');
    assert.ok(statusEvidence?.teamRunCount >= 1);
    const summary = statusEvidence?.teamRuns?.find((entry: any) => entry.teamRunId === teamRun.teamRunId);
    assert.equal(summary?.taskId, taskId);
    assert.equal(summary?.actorId, 'codex-main');
    assert.equal(summary?.recipeId, 'atm.default.normal.typescript');
    assert.equal(summary?.status, 'active');
    assert.equal(summary?.roleCount, teamRun.roles.length);
    assert.equal(summary?.leaseCount, teamRun.leases.length);
    assert.equal(summary?.brokerSubagentEnabled, true);
    assert.equal(summary?.brokerDecisionSurface, 'brokerLane');
    assert.equal(summary?.brokerStewardId, 'neutral-write-steward');
    assert.equal(summary?.brokerGovernanceSummaryId, 'atm.teamBrokerGovernanceSummary.v1');
    assert.deepEqual(summary?.brokerEvidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
    assert.equal(summary?.commitLaneSerializedBy, 'branch-commit-queue');
    assert.equal(summary?.commitLaneOwnerRole, 'coordinator');
    assert.equal(summary?.workerGitWrite, false);
    assert.equal(summary?.workerTaskLifecycle, false);
    assert.equal(summary?.workerSelfClose, false);
    assert.equal(summary?.agentsSpawned, false);

    const runtimePath = path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRun.teamRunId}.json`);
    assert.equal(existsSync(runtimePath), true);
    rmSync(cwd, { recursive: true, force: true });

    console.log('[validate-team-agents] ok (start-status)');
    return;
  }

  if (taskCase === 'runtime-mode-contract') {
    const runtimeContractSchema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'team-agents', 'team-runtime-contract.schema.json'), 'utf8'));
    const validateRuntimeContract = new Ajv2020({ allErrors: true }).compile(runtimeContractSchema);
    const assertRuntimeContractSchema = (contract: unknown, label: string) => {
      assert.ok(validateRuntimeContract(contract), `${label} runtime contract must match schema: ${JSON.stringify(validateRuntimeContract.errors)}`);
    };

    const defaultContract = buildTeamRuntimeContract({});
    assertRuntimeContractSchema(defaultContract, 'default');
    assert.equal(defaultContract.runtimeMode, 'broker-only');
    assert.equal(defaultContract.runtimeLanguage, 'node');
    assert.equal(defaultContract.executionSurface, 'broker-governance');
    assert.equal(defaultContract.agentsSpawned, false);
    assert.equal(defaultContract.commitLane.schemaId, 'atm.teamCommitLaneContract.v1');
    assert.equal(defaultContract.commitLane.ownerRole, 'coordinator');
    assert.deepEqual(defaultContract.commitLane.ownerPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);
    assert.equal(defaultContract.commitLane.workerGitWrite, false);
    assert.equal(defaultContract.commitLane.serializedBy, 'branch-commit-queue');
    assert.equal(defaultContract.commitLane.lockSchemaId, 'atm.branchCommitQueueLock.v1');
    assert.deepEqual(defaultContract.commitLane.retryableCodes, ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']);
    assert.equal(defaultContract.brokerSubagent.schemaId, 'atm.teamBrokerSubagentContract.v1');
    assert.equal(defaultContract.brokerSubagent.enabled, true);
    assert.equal(defaultContract.brokerSubagent.subagentId, 'team-broker-subagent');
    assert.equal(defaultContract.brokerSubagent.lifecycleOwner, 'atm');
    assert.equal(defaultContract.brokerSubagent.decisionSurface, 'brokerLane');
    assert.deepEqual(defaultContract.brokerSubagent.governs, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.equal(defaultContract.brokerSubagent.stewardId, 'neutral-write-steward');
    assert.deepEqual(defaultContract.brokerSubagent.evidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
    assert.equal(defaultContract.brokerSubagent.authorityBoundary.fileWrite, false);
    assert.equal(defaultContract.brokerSubagent.authorityBoundary.gitWrite, false);
    assert.equal(defaultContract.brokerSubagent.authorityBoundary.taskLifecycle, false);
    assert.equal(defaultContract.brokerSubagent.authorityBoundary.selfClose, false);
    assert.equal(defaultContract.brokerSubagent.escalationTarget, 'coordinator');
    assert.ok(defaultContract.selectionReason.includes('broker-only selected'));

    const realAgentContract = buildTeamRuntimeContract({
      runtimeMode: 'real-agent',
      runtimeLanguage: 'python',
      runtimeAdapterId: 'atm.node.reference',
      providerId: 'local',
      sdkId: 'node-sdk',
      modelId: 'model-a'
    });
    assertRuntimeContractSchema(realAgentContract, 'real-agent');
    assert.equal(realAgentContract.runtimeMode, 'real-agent');
    assert.equal(realAgentContract.runtimeLanguage, 'python');
    assert.equal(realAgentContract.runtimeAdapterId, 'atm.node.reference');
    assert.equal(realAgentContract.providerId, 'local');
    assert.equal(realAgentContract.sdkId, 'node-sdk');
    assert.equal(realAgentContract.modelId, 'model-a');
    assert.equal(realAgentContract.executionSurface, 'agent-runtime');
    assert.equal(realAgentContract.agentsSpawned, true);

    const editorContract = buildTeamRuntimeContract({ runtimeMode: 'editor-subagent' });
    assertRuntimeContractSchema(editorContract, 'editor-subagent');
    assert.equal(editorContract.executionSurface, 'editor-subagent');
    assert.equal(editorContract.runtimeLanguage, 'node');

    assert.throws(
      () => buildTeamRuntimeContract({ runtimeMode: 'unsupported-mode' }),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_RUNTIME_MODE_INVALID'
    );

    const start = await runTeam([
      'start',
      '--task',
      'TASK-TEAM-0031',
      '--actor',
      'codex-runtime-validator',
      '--runtime-mode',
      'broker-only',
      '--runtime-adapter',
      'atm.node.broker',
      '--provider',
      'local',
      '--sdk',
      'none',
      '--model',
      'none',
      '--cwd',
      process.cwd(),
      '--json'
    ]);
    const evidence = start.evidence as any;
    assert.equal(start.ok, true);
    assert.equal(evidence?.runtimeContract?.schemaId, 'atm.teamRuntimeContract.v1');
    assert.equal(evidence?.runtimeContract?.runtimeMode, 'broker-only');
    assert.equal(evidence?.runtimeContract?.runtimeLanguage, 'node');
    assert.equal(evidence?.runtimeContract?.runtimeAdapterId, 'atm.node.broker');
    assert.equal(evidence?.runtimeContract?.providerId, 'local');
    assert.equal(evidence?.runtimeContract?.sdkId, 'none');
    assert.equal(evidence?.runtimeContract?.modelId, 'none');
    assert.equal(evidence?.runtimeContract?.executionSurface, 'broker-governance');
    assert.equal(evidence?.runtimeContract?.agentsSpawned, false);
    assert.equal(evidence?.agentsSpawned, false);
    assert.equal(evidence?.teamRun?.runtimeMode, 'broker-only');
    assert.equal(evidence?.teamRun?.runtimeLanguage, 'node');
    assert.equal(evidence?.teamRun?.runtimeAdapterId, 'atm.node.broker');
    assert.equal(evidence?.teamRun?.providerId, 'local');
    assert.equal(evidence?.teamRun?.sdkId, 'none');
    assert.equal(evidence?.teamRun?.modelId, 'none');
    assert.equal(evidence?.teamRun?.executionMode, 'manual-team');
    assert.equal(evidence?.teamRun?.executionSurface, 'broker-governance');
    assert.equal(evidence?.teamRun?.agentsSpawned, false);
    assert.ok(String(evidence?.teamRun?.teamSummary?.implementationSummary).includes('broker-only selected'));

    console.log('[validate-team-agents] ok (runtime-mode-contract)');
    return;
  }

  if (taskCase === 'command-spec-broker-surface') {
    assert.ok(teamSpecBrokerLane.summary.includes('write transaction identity'));
    assert.ok(teamSpecBrokerLane.summary.includes('lease epoch'));
    assert.ok(teamSpecBrokerLane.summary.includes('read/write sets'));
    assert.ok(teamSpecBrokerLane.summary.includes('file hashes'));
    assert.ok(teamSpecBrokerLane.summary.includes('broker decision linkage'));
    assert.ok(teamSpecRuntimeStatus.summary.includes('broker subagent status fields'));
    assert.ok(teamSpecRuntimeStatus.summary.includes('serialized commit lane'));
    assert.ok(teamSpecRuntimeStatus.examples.some((entry) => entry.includes('team status --compact')));
    assert.ok(teamSpecPatrolReport.summary.includes('broker-governance drift'));
    assert.ok(teamSpecPatrolReport.examples.some((entry) => entry.includes('--team <teamRunId>')));
    assert.ok(TEAM_ATOM_BOUNDARIES['team.patrol-report'].capability.includes('broker-governance evidence gates'));

    console.log('[validate-team-agents] ok (command-spec-broker-surface)');
    return;
  }

  if (taskCase === 'editor-subagent-bridge') {
    const editorContract = buildTeamRuntimeContract({
      runtimeMode: 'editor-subagent',
      runtimeLanguage: 'node',
      runtimeAdapterId: 'codex.desktop.subagent',
      providerId: 'codex',
      sdkId: 'editor-native',
      modelId: 'gpt-5',
      recipe: {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.editor-subagent.fixture',
        language: 'typescript',
        agents: [
          {
            agentId: 'coordinator',
            role: 'coordinator',
            profile: 'atm.coordinator.v1',
            permissions: ['task.lifecycle', 'git.write', 'evidence.write']
          },
          {
            agentId: 'implementer-typescript',
            role: 'implementer',
            profile: 'atm.implementer.typescript.v1',
            language: 'typescript',
            permissions: ['file.write']
          },
          {
            agentId: 'validator',
            role: 'validator',
            profile: 'atm.validator.v1',
            permissions: ['exec.validator']
          }
        ]
      },
      allowedFiles: ['packages/cli/src/commands/team.ts', 'scripts/validate-team-agents.ts'],
      permissionLeases: [
        { permission: 'file.write', agentId: 'implementer-typescript', paths: ['packages/cli/src/commands/team.ts'] },
        { permission: 'exec.validator', agentId: 'validator', paths: ['scripts/validate-team-agents.ts'] }
      ],
      evidenceRequired: 'command-backed'
    });
    assert.equal(editorContract.runtimeMode, 'editor-subagent');
    assert.equal(editorContract.executionSurface, 'editor-subagent');
    assert.equal(editorContract.agentsSpawned, true);
    assert.equal(editorContract.editorSubagentBridge.enabled, true);
    assert.equal(editorContract.editorSubagentBridge.lifecycleOwner, 'atm');
    assert.equal(editorContract.editorSubagentBridge.editorNeutral, true);
    assert.deepEqual(editorContract.editorSubagentBridge.allowedFiles, ['packages/cli/src/commands/team.ts', 'scripts/validate-team-agents.ts']);
    const implementerEnvelope = editorContract.editorSubagentBridge.roleEnvelopes.find((entry: any) => entry.agentId === 'implementer-typescript');
    assert.ok(implementerEnvelope, 'editor bridge must emit an implementer role envelope');
    assert.equal(implementerEnvelope.role, 'implementer');
    assert.equal(implementerEnvelope.profile, 'atm.implementer.typescript.v1');
    assert.deepEqual(implementerEnvelope.allowedFiles, editorContract.editorSubagentBridge.allowedFiles);
    assert.deepEqual(implementerEnvelope.permissions, ['file.write']);
    assert.equal(implementerEnvelope.leaseMetadata.leaseOwner, 'implementer-typescript');
    assert.equal(implementerEnvelope.leaseMetadata.permissionLeases[0].permission, 'file.write');
    assert.equal(implementerEnvelope.artifactMetadata.evidenceRequired, 'command-backed');
    assert.equal(implementerEnvelope.retryMetadata.retryPolicy, 'atm-governed');

    const disabledContract = buildTeamRuntimeContract({
      runtimeMode: 'editor-subagent',
      editorBridgeDisabled: true,
      recipe: editorContract.editorSubagentBridge.roleEnvelopes.length > 0 ? {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.editor-subagent.disabled',
        agents: []
      } : undefined
    });
    assert.equal(disabledContract.editorSubagentBridge.enabled, false);
    assert.equal(disabledContract.editorSubagentBridge.disabledReason, 'disabled-by-run-option');
    assert.equal(disabledContract.executionSurface, 'editor-subagent');

    console.log('[validate-team-agents] ok (editor-subagent-bridge)');
    return;
  }

  if (taskCase === 'rework-route-state-machine') {
    const needsRework = buildTeamReworkRouteStateMachine({
      findings: [
        {
          source: 'reviewer',
          id: 'reviewer-blocking-finding',
          blocking: true,
          severity: 'blocker',
          summary: 'Reviewer found an implementation gap.'
        },
        {
          source: 'validator',
          id: 'validator-failure',
          passed: false,
          severity: 'error',
          summary: 'Focused validator failed.'
        }
      ],
      requiredChecksPassed: false,
      retryBudgetMax: 2,
      retryBudgetUsed: 0
    });
    assert.equal(needsRework.schemaId, 'atm.teamReworkRoute.v1');
    assert.equal(needsRework.status, 'needs-rework');
    assert.equal(needsRework.retryBudget.escalationTarget, null);
    assert.equal(needsRework.transitions[0].from, 'work-in-progress');
    assert.equal(needsRework.transitions[0].to, 'needs-rework');
    assert.deepEqual(needsRework.transitions[0].findingIds, ['reviewer-blocking-finding', 'validator-failure']);

    const readyForClose = transitionTeamReworkRoute(needsRework, {
      findings: [
        {
          source: 'validator',
          id: 'validator-revalidation-pass',
          passed: true,
          severity: 'info',
          summary: 'Focused validators passed after rework.'
        }
      ],
      requiredChecksPassed: true,
      retryBudgetUsed: 1
    });
    assert.equal(readyForClose.status, 'ready-for-close');
    assert.equal(readyForClose.retryBudget.escalationTarget, null);
    assert.ok(
      readyForClose.transitions.some((entry: any) => entry.from === 'needs-rework' && entry.to === 'revalidate-pending'),
      'rework completion must route through revalidate-pending'
    );
    assert.ok(
      readyForClose.transitions.some((entry: any) => entry.to === 'ready-for-close'),
      'required checks passing must formally route to ready-for-close'
    );

    const blocked = buildTeamReworkRouteStateMachine({
      findings: [
        {
          source: 'validator',
          id: 'retry-exhausted-validator-failure',
          passed: false,
          severity: 'error'
        }
      ],
      retryBudgetMax: 1,
      retryBudgetUsed: 1
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.retryBudget.remaining, 0);
    assert.equal(blocked.retryBudget.escalationTarget, 'captain');
    assert.ok(
      blocked.transitions.some((entry: any) => entry.to === 'blocked'),
      'retry exhaustion must route to blocked instead of looping'
    );

    const reviewerTextOnly = buildTeamReworkRouteStateMachine({
      findings: [
        {
          source: 'reviewer',
          id: 'advisory-review-note',
          blocking: false,
          severity: 'info'
        }
      ],
      requiredChecksPassed: false
    });
    assert.notEqual(reviewerTextOnly.status, 'ready-for-close');

    console.log('[validate-team-agents] ok (rework-route-state-machine)');
    return;
  }

  if (taskCase === 'artifact-handoff-retry') {
    const contract = buildTeamRuntimeContract({
      runtimeMode: 'editor-subagent',
      recipe: {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.artifact-handoff.fixture',
        language: 'typescript',
        agents: [
          {
            agentId: 'implementer-typescript',
            role: 'implementer',
            profile: 'atm.implementer.typescript.v1',
            language: 'typescript',
            permissions: ['file.write']
          },
          {
            agentId: 'validator',
            role: 'validator',
            profile: 'atm.validator.v1',
            permissions: ['exec.validator']
          }
        ]
      },
      allowedFiles: ['packages/cli/src/commands/team.ts'],
      evidenceRequired: 'command-backed'
    });

    assert.equal(contract.artifactHandoff.schemaId, 'atm.teamArtifactHandoffContract.v1');
    assert.deepEqual(contract.artifactHandoff.requiredRoles, ['evidence-collector', 'implementer', 'reviewer', 'validator']);
    for (const role of contract.artifactHandoff.requiredRoles) {
      const roleContract = contract.artifactHandoff.roleContracts.find((entry: any) => entry.role === role);
      assert.ok(roleContract, `missing role artifact contract for ${role}`);
      assert.ok(roleContract.consumesFrom.length > 0, `${role} must declare consumed artifacts`);
      assert.ok(roleContract.producesTo.length > 0, `${role} must declare artifact destinations`);
      assert.ok(roleContract.requiredArtifacts.length > 0, `${role} must declare required artifacts`);
    }

    const missingFindings = validateTeamArtifactHandoff({
      roleContracts: contract.artifactHandoff.roleContracts,
      producedArtifacts: ['implementation-diff']
    });
    assert.ok(
      missingFindings.some((entry: any) => entry.code === 'missing-required-artifact' && entry.blocking === true),
      'missing required artifacts must produce blocking findings'
    );

    const completeHandoff = buildTeamArtifactHandoffContract({
      recipe: {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.artifact-handoff.complete',
        agents: []
      },
      producedArtifacts: [
        'implementation-diff',
        'implementation-notes',
        'review-findings',
        'validator-results',
        'command-backed-evidence',
        'closure-packet'
      ]
    });
    assert.equal(completeHandoff.closeAllowed, true);
    assert.deepEqual(completeHandoff.findings, []);

    const budget = buildTeamRetryBudgetContract({
      maxReworkCycles: 2,
      maxValidatorReruns: 3,
      maxReviewerReturns: 1,
      usedReworkCycles: 2,
      escalationTarget: 'captain'
    });
    assert.equal(budget.maxReworkCycles, 2);
    assert.equal(budget.maxValidatorReruns, 3);
    assert.equal(budget.maxReviewerReturns, 1);
    assert.equal(budget.status, 'escalation-required');
    assert.equal(budget.escalationTarget, 'captain');

    const evidence = buildTeamArtifactHandoffEvidence({
      producedArtifacts: ['implementation-diff', 'validator-results'],
      missingArtifacts: ['review-findings'],
      retryBudgetStatus: budget.status,
      escalationTarget: budget.escalationTarget,
      closeAllowed: false
    });
    assert.equal(evidence.schemaId, 'atm.teamArtifactHandoffEvidence.v1');
    assert.equal(evidence.retryBudgetStatus, 'escalation-required');
    assert.equal(evidence.escalationTarget, 'captain');
    assert.equal(evidence.closeAllowed, false);

    const implementerEnvelope = contract.editorSubagentBridge.roleEnvelopes.find((entry: any) => entry.role === 'implementer');
    assert.ok(implementerEnvelope, 'editor bridge must carry role artifact metadata');
    assert.deepEqual(implementerEnvelope.artifactMetadata.requiredArtifacts, ['implementation-diff', 'implementation-notes']);
    assert.ok(implementerEnvelope.artifactMetadata.consumesFrom.includes('task-card'));
    assert.ok(implementerEnvelope.artifactMetadata.producesTo.includes('validator'));

    console.log('[validate-team-agents] ok (artifact-handoff-retry)');
    return;
  }

  if (taskCase === 'nodejs-worker-adapter') {
    const nodeAdapter = resolveNodejsTeamWorkerAdapter({
      runtimeMode: 'real-agent',
      runtimeLanguage: 'node',
      providerId: 'local',
      sdkId: 'nodejs-reference',
      modelId: 'fixture-model'
    });
    assert.equal(nodeAdapter.schemaId, 'atm.teamWorkerAdapterContract.v1');
    assert.equal(nodeAdapter.adapterId, 'atm.node.reference-worker');
    assert.equal(nodeAdapter.executionSurface, 'agent-runtime');
    assert.equal(nodeAdapter.spawnStrategy, 'spawn-worker');
    assert.equal(nodeAdapter.agentsSpawned, true);
    assert.equal(nodeAdapter.authorityBoundary.gitWrite, false);
    assert.equal(nodeAdapter.authorityBoundary.taskLifecycle, false);
    assert.equal(nodeAdapter.authorityBoundary.selfClose, false);
    assert.equal(nodeAdapter.authorityBoundary.evidenceWriteOwner, 'coordinator');
    assert.equal(nodeAdapter.vendorNeutral, true);
    assert.equal(nodeAdapter.artifactContractPreserved, true);
    assert.equal(nodeAdapter.retryContractPreserved, true);

    const brokerFallback = resolveNodejsTeamWorkerAdapter({ runtimeMode: 'broker-only' });
    assert.equal(brokerFallback.adapterId, 'atm.node.broker-only-fallback');
    assert.equal(brokerFallback.executionSurface, 'broker-governance');
    assert.equal(brokerFallback.spawnStrategy, 'disabled');
    assert.equal(brokerFallback.agentsSpawned, false);
    assert.equal(brokerFallback.authorityBoundary.gitWrite, false);
    assert.equal(brokerFallback.authorityBoundary.taskLifecycle, false);
    assert.equal(brokerFallback.authorityBoundary.selfClose, false);
    assert.equal(brokerFallback.brokerFallback.enabled, true);
    for (const preserved of ['broker', 'permission-leases', 'validators', 'police', 'evidence', 'artifact-contract', 'retry-contract']) {
      assert.ok(brokerFallback.brokerFallback.preservesGovernance.includes(preserved), `broker fallback must preserve ${preserved}`);
    }

    const realRuntime = buildTeamRuntimeContract({ runtimeMode: 'real-agent', runtimeLanguage: 'node' });
    assert.equal(realRuntime.runtimeAdapterId, 'atm.node.reference-worker');
    assert.equal(realRuntime.providerId, 'local');
    assert.equal(realRuntime.sdkId, 'nodejs');
    assert.equal(realRuntime.modelId, 'provider-selected');
    assert.equal(realRuntime.workerAdapter.adapterId, 'atm.node.reference-worker');
    assert.equal(realRuntime.workerAdapter.authorityBoundary.gitWrite, false);
    assert.equal(realRuntime.workerAdapter.authorityBoundary.taskLifecycle, false);
    assert.equal(realRuntime.commitLane.workerGitWrite, false);
    assert.equal(realRuntime.commitLane.serializedBy, 'branch-commit-queue');
    assert.equal(realRuntime.brokerSubagent.enabled, true);
    assert.equal(realRuntime.brokerSubagent.authorityBoundary.fileWrite, false);
    assert.equal(realRuntime.brokerSubagent.authorityBoundary.gitWrite, false);
    assert.deepEqual(realRuntime.brokerSubagent.governs, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.equal(realRuntime.agentsSpawned, true);
    assert.equal(realRuntime.artifactHandoff.schemaId, 'atm.teamArtifactHandoffContract.v1');
    assert.equal(realRuntime.retryBudget.schemaId, 'atm.teamRetryBudgetContract.v1');

    const brokerRuntime = buildTeamRuntimeContract({ runtimeMode: 'broker-only' });
    assert.equal(brokerRuntime.runtimeAdapterId, 'atm.node.broker-only-fallback');
    assert.equal(brokerRuntime.workerAdapter.brokerFallback.enabled, true);
    assert.equal(brokerRuntime.workerAdapter.authorityBoundary.selfClose, false);
    assert.equal(brokerRuntime.commitLane.ownerRole, 'coordinator');
    assert.equal(brokerRuntime.brokerSubagent.decisionSurface, 'brokerLane');
    assert.equal(brokerRuntime.brokerSubagent.stewardId, 'neutral-write-steward');
    assert.equal(brokerRuntime.brokerSubagent.escalationTarget, 'coordinator');
    assert.equal(brokerRuntime.agentsSpawned, false);
    assert.equal(brokerRuntime.executionSurface, 'broker-governance');
    assert.equal(brokerRuntime.artifactHandoff.schemaId, realRuntime.artifactHandoff.schemaId);
    assert.equal(brokerRuntime.retryBudget.schemaId, realRuntime.retryBudget.schemaId);

    console.log('[validate-team-agents] ok (nodejs-worker-adapter)');
    return;
  }

  if (taskCase === 'polyglot-worker-examples') {
    const examplesDir = path.join(process.cwd(), 'examples', 'team-runtime');
    const readme = readFileSync(path.join(examplesDir, 'README.md'), 'utf8');
    const python = readFileSync(path.join(examplesDir, 'python-reference-worker-adapter.py'), 'utf8');
    const csharp = readFileSync(path.join(examplesDir, 'csharp-reference-worker-adapter.cs'), 'utf8');
    const nodeFallback = resolveNodejsTeamWorkerAdapter({ runtimeMode: 'broker-only' });

    assert.ok(readme.includes('Node.js remains the default Team runtime'), 'README must keep Node.js as the default runtime');
    assert.ok(readme.includes('Command-backed evidence is still required before closeout'), 'README must require command-backed evidence');
    assert.ok(readme.includes('Captain-owned task lifecycle remains unchanged'), 'README must preserve closure authority');

    const requiredGovernance = [
      ...nodeFallback.brokerFallback.preservesGovernance,
      'closure-authority'
    ];

    for (const [language, content, adapterId] of [
      ['python', python, 'atm.python.reference-worker'],
      ['csharp', csharp, 'atm.csharp.reference-worker']
    ] as const) {
      assert.ok(content.includes('atm.teamWorkerAdapterContract.v1'), `${language} example must use the Team worker adapter schema`);
      assert.ok(content.includes(adapterId), `${language} example must declare its reference adapter id`);
      assert.ok(content.includes(language), `${language} example must declare runtimeLanguage`);
      assert.ok(content.includes('Node.js remains the default ATM Team runtime'), `${language} example must not claim default-runtime status`);
      assert.ok(content.includes('commandBackedEvidenceRequired') || content.includes('CommandBackedEvidenceRequired'), `${language} example must require command-backed evidence`);
      assert.ok(content.includes('closureAuthorityPreserved') || content.includes('ClosureAuthorityPreserved'), `${language} example must preserve closure authority`);
      assert.ok(content.includes('artifactContractPreserved') || content.includes('ArtifactContractPreserved'), `${language} example must preserve artifact handoff`);
      assert.ok(content.includes('retryContractPreserved') || content.includes('RetryContractPreserved'), `${language} example must preserve retry governance`);

      for (const preserved of requiredGovernance) {
        assert.ok(content.includes(preserved), `${language} example must preserve ${preserved}`);
      }
    }

    console.log('[validate-team-agents] ok (polyglot-worker-examples)');
    return;
  }

  if (taskCase === 'sandbox-attestation') {
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
    return;
  }

  if (taskCase === 'claim-gate-parity') {
    const cwd = process.cwd();
    const taskId = 'TASK-TEAM-0029-FIXTURE';
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    const runtimeDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
    const beforeRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      title: 'Team claim gate parity fixture',
      status: 'ready',
      dependencies: ['TASK-TEAM-0029-MISSING-DEPENDENCY'],
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case claim-gate-parity'],
      acceptance: ['Team start must fail closed when normal task claim dependency gates would reject the task.']
    }, null, 2)}\n`, 'utf8');
    try {
      const plan = await runTeam(['plan', '--task', taskId, '--cwd', cwd, '--json']);
      const planEvidence = plan.evidence as any;
      const planFindings = planEvidence?.teamPlan?.validation?.findings ?? [];
      assert.equal(plan.ok, false);
      assert.ok(planFindings.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

      const validate = await runTeam(['validate', '--task', taskId, '--cwd', cwd, '--json']);
      const validateEvidence = validate.evidence as any;
      assert.equal(validate.ok, true);
      assert.equal(validateEvidence?.safeToStart, false);
      assert.ok(validateEvidence?.relatedFindings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

      const start = await runTeam(['start', '--task', taskId, '--actor', 'claim-gate-validator', '--cwd', cwd, '--json']);
      const startEvidence = start.evidence as any;
      assert.equal(start.ok, false);
      assert.equal(startEvidence?.runtimeWritten, false);
      assert.ok(startEvidence?.validation?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));
      const afterRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
      assert.deepEqual(afterRuntimeFiles, beforeRuntimeFiles);
    } finally {
      rmSync(taskPath, { force: true });
    }

    console.log('[validate-team-agents] ok (claim-gate-parity)');
    return;
  }

  if (taskCase === 'closure-summary') {
    const cwd = process.cwd();
    const teamRunId = 'team-closure-summary-fixture';
    const runtimePath = path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`);
    mkdirSync(path.dirname(runtimePath), { recursive: true });
    writeFileSync(runtimePath, `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId: 'TASK-TEAM-0016',
      actorId: 'validator',
      status: 'active',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      captainDecision: { decision: 'close', reason: 'fixture captain decision' },
      agentReports: [{ role: 'validator', status: 'done', recommendation: 'close' }],
      patrolFindings: ['no scope drift found'],
      evidenceCuratorSummary: { summary: 'command-backed evidence remains authoritative' },
      teamSummary: {
        decision: 'close',
        implementationSummary: 'closure summary fixture',
        validators: ['typecheck'],
        evidence: ['fixture command evidence'],
        brokerGovernance: {
          schemaId: 'atm.teamBrokerGovernanceSummary.v1',
          brokerSubagentEnabled: true,
          brokerDecisionSurface: 'brokerLane',
          brokerStewardId: 'neutral-write-steward',
          brokerGoverns: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
          brokerEvidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
          commitLaneSerializedBy: 'branch-commit-queue',
          commitLaneOwnerRole: 'coordinator',
          workerGitWrite: false,
          workerTaskLifecycle: false,
          workerSelfClose: false
        },
        risk: 'low',
        closeReady: true
      }
    }, null, 2)}\n`, 'utf8');
    try {
      const packet = createClosurePacket({
        cwd,
        taskId: 'TASK-TEAM-0016',
        actorId: 'validator',
        evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
        changedFiles: ['packages/cli/src/commands/team.ts']
      });
      assert.equal(packet.teamSummary?.teamRunId, teamRunId);
      assert.equal((packet.teamSummary?.captainDecision as any)?.decision, 'close');
      assert.equal(packet.teamSummary?.agentReports.length, 1);
      assert.equal(packet.teamSummary?.patrolFindings.length, 1);
      assert.equal((packet.teamSummary?.evidenceCuratorSummary as any)?.summary, 'command-backed evidence remains authoritative');
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.schemaId, 'atm.teamBrokerGovernanceSummary.v1');
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerSubagentEnabled, true);
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerDecisionSurface, 'brokerLane');
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerStewardId, 'neutral-write-steward');
      assert.deepEqual((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerGoverns, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
      assert.deepEqual((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerEvidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.commitLaneSerializedBy, 'branch-commit-queue');
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.commitLaneOwnerRole, 'coordinator');
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerGitWrite, false);
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerTaskLifecycle, false);
      assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerSelfClose, false);

      const noSummaryPacket = createClosurePacket({
        cwd,
        taskId: 'TASK-TEAM-0016',
        actorId: 'validator',
        evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
        changedFiles: ['packages/cli/src/commands/team.ts'],
        teamSummary: null
      });
      assert.equal(noSummaryPacket.teamSummary, null);
    } finally {
      rmSync(runtimePath, { force: true });
    }

    console.log('[validate-team-agents] ok (closure-summary)');
    return;
  }

  if (taskCase === 'knowledge-boundary') {
    const contract = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/knowledge-index-contract.md'), 'utf8');
    const templatesReadme = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/templates/README.md'), 'utf8');
    const shardTemplate = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/templates/team-memory-shard-template.md'), 'utf8');

    for (const content of [contract, templatesReadme, shardTemplate]) {
      assert.ok(content.includes('.atm/knowledge/**'));
      assert.ok(content.includes('.atm/runtime/knowledge/**'));
      assert.match(content, /advisory/i);
    }

    assert.match(contract, /not a second task\s+registry|never a second task\s+registry/i);
    assert.match(contract, /promotion path/i);
    assert.match(contract, /closure authority/i);
    assert.match(templatesReadme, /cache-only/i);
    assert.match(shardTemplate, /Authority: advisory-only/);

    console.log('[validate-team-agents] ok (knowledge-boundary)');
    return;
  }

  if (taskCase === 'minimal-team-agents-example') {
    const root = path.join(process.cwd(), 'examples', 'team-agents-minimal');
    const requiredFiles = [
      'README.md',
      'team-brief.md',
      'agent-report.md',
      'team-summary.md',
      'captain-decision.md',
      'team-memory-shard.md',
      'patrol-report.md',
      'QUICK_START_WALK_THROUGH.md'
    ];
    for (const file of requiredFiles) {
      assert.equal(existsSync(path.join(root, file)), true, `${file} should exist`);
    }
    assert.ok(readFileSync(path.join(root, 'team-brief.md'), 'utf8').includes('Team level: L1'));
    assert.ok(readFileSync(path.join(root, 'team-summary.md'), 'utf8').includes('decisionClass'));
    assert.ok(readFileSync(path.join(root, 'QUICK_START_WALK_THROUGH.md'), 'utf8').includes('90 minutes'));
    console.log('[validate-team-agents] ok (minimal-team-agents-example)');
    return;
  }

  if (taskCase === 'knowledge-build-query') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'routing.md'), [
      '# Team routing knowledge',
      'repo: AI-Atomic-Framework',
      'channel: normal',
      'domain: team-agents',
      'paths: packages/cli/src/commands/team.ts, scripts/validate-team-agents.ts',
      'atoms: team.knowledge-build-query',
      'validators: npm run validate:cli, node --strip-types scripts/validate-team-agents.ts',
      '',
      'Use this advisory shard when a Team Agents task needs metadata filtering before lexical ranking.'
    ].join('\n'), 'utf8');

    try {
      const dryRun = await runTeam(['knowledge', 'build', '--scope', 'project', '--dry-run', '--cwd', cwd, '--json']);
      const dryEvidence = dryRun.evidence as any;
      assert.equal(dryRun.ok, true);
      assert.equal(dryEvidence?.action, 'knowledge.build');
      assert.equal(dryEvidence?.advisoryOnly, true);
      assert.equal(dryEvidence?.dryRun, true);
      assert.equal(dryEvidence?.shardCount, 1);
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), false);

      const missingQuery = await runTeam(['knowledge', 'query', '--query', 'metadata filtering lexical ranking', '--top', '5', '--cwd', cwd, '--json']);
      const missingEvidence = missingQuery.evidence as any;
      assert.equal(missingQuery.ok, true);
      assert.equal(missingEvidence?.indexStatus, 'missing');
      assert.ok(missingQuery.messages.some((entry: any) => entry.code === 'ATM_TEAM_KNOWLEDGE_INDEX_MISSING'));
      assert.ok(String(missingEvidence?.buildCommand).includes('team knowledge build'));

      const deniedBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'knowledge-scout', '--cwd', cwd, '--json']);
      const deniedEvidence = deniedBuild.evidence as any;
      assert.equal(deniedBuild.ok, false);
      assert.equal(deniedEvidence?.permission?.permission, 'knowledge.index.write');
      assert.ok(deniedBuild.messages.some((entry: any) => entry.code === 'ATM_TEAM_KNOWLEDGE_INDEX_WRITE_FORBIDDEN'));

      const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'coordinator', '--cwd', cwd, '--json']);
      const writeEvidence = writeBuild.evidence as any;
      assert.equal(writeBuild.ok, true);
      assert.equal(writeEvidence?.permission?.permission, 'knowledge.index.write');
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), true);

      const query = await runTeam([
        'knowledge',
        'query',
        '--query',
        'metadata filtering lexical ranking',
        '--domain',
        'team-agents',
        '--atom',
        'team.knowledge-build-query',
        '--top',
        '5',
        '--cwd',
        cwd,
        '--json'
      ]);
      const queryEvidence = query.evidence as any;
      assert.equal(query.ok, true);
      assert.equal(queryEvidence?.action, 'knowledge.query');
      assert.equal(queryEvidence?.advisoryOnly, true);
      assert.equal(queryEvidence?.indexStatus, 'ready');
      assert.equal(queryEvidence?.hits?.length, 1);
      assert.equal(queryEvidence?.hits?.[0]?.path, '.atm/knowledge/team/routing.md');
      assert.equal(typeof queryEvidence?.hits?.[0]?.snippet, 'string');
      assert.equal(Object.hasOwn(queryEvidence.hits[0], 'searchText'), false);

      mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
      writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-KNOW-0001.json'), `${JSON.stringify({
        schemaId: 'atm.taskLedger.v1',
        workItemId: 'TASK-KNOW-0001',
        title: 'Team routing knowledge task',
        status: 'ready',
        scopePaths: ['packages/cli/src/commands/team.ts'],
        deliverables: ['packages/cli/src/commands/team.ts'],
        validators: ['node --strip-types scripts/validate-team-agents.ts --case knowledge-build-query'],
        acceptance: ['Captain brief shows advisory knowledge hits.']
      }, null, 2)}\n`, 'utf8');
      const plan = await runTeam(['plan', '--task', 'TASK-KNOW-0001', '--cwd', cwd, '--json']);
      const planEvidence = plan.evidence as any;
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.schemaId, 'atm.teamKnowledgeSummary.v1');
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.advisoryOnly, true);
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.top, 3);
      assert.ok(Array.isArray(planEvidence?.teamPlan?.knowledgeSummary?.hits));
      assert.ok(String(planEvidence?.teamPlan?.knowledgeSummary?.followUpCommand).includes('team knowledge query'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-build-query)');
    return;
  }

  if (taskCase === 'knowledge-retention-budget') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-retention');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'active.md'), [
      '# Active team lesson',
      'status: active',
      'domain: team-agents',
      '',
      'Retained advisory knowledge for active Team Agents work.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md'), [
      '# Old team lesson',
      'status: superseded',
      'supersededBy: .atm/knowledge/team/active.md',
      '',
      'This shard remains canonical source and requires human review before archive.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json'), '{"entries":[]}\n', 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin'), 'runtime embedding cache fixture', 'utf8');

    try {
      const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--warning-bytes', '1', '--budget-bytes', '10', '--json']);
      const statsEvidence = stats.evidence as any;
      assert.equal(stats.ok, true);
      assert.equal(statsEvidence?.action, 'knowledge.stats');
      assert.equal(statsEvidence?.schemaId, 'atm.teamKnowledgeStats.v1');
      assert.equal(statsEvidence?.advisoryOnly, true);
      assert.equal(statsEvidence?.shardCount, 2);
      assert.ok(statsEvidence?.runtimeIndexBytes > 0);
      assert.ok(statsEvidence?.runtimeCacheBytes > 0);
      assert.ok(statsEvidence?.embeddingCacheBytes > 0);
      assert.equal(statsEvidence?.supersededShardCount, 1);
      assert.equal(statsEvidence?.archiveCandidateCount, 1);
      assert.equal(statsEvidence?.budget?.status, 'hard-limit');

      const compact = await runTeam(['knowledge', 'compact', '--dry-run', '--cwd', cwd, '--json']);
      const compactEvidence = compact.evidence as any;
      assert.equal(compact.ok, true);
      assert.equal(compactEvidence?.action, 'knowledge.compact');
      assert.equal(compactEvidence?.dryRun, true);
      assert.equal(compactEvidence?.canonicalMutated, false);
      assert.equal(compactEvidence?.runtimeCacheMutated, false);
      assert.equal(compactEvidence?.archiveCandidates?.length, 1);
      assert.equal(compactEvidence?.archiveCandidates?.[0]?.path, '.atm/knowledge/team/old-superseded.md');
      assert.ok(compactEvidence?.runtimePrunableFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/embeddings/lesson-cache.bin'));
      assert.equal(existsSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md')), true);
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin')), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-retention-budget)');
    return;
  }

  if (taskCase === 'knowledge-hybrid-rerank') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-hybrid');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'alpha.md'), [
      '# Alpha lexical note',
      'domain: team-agents',
      'atoms: team.knowledge-hybrid-rerank',
      '',
      'Lexical common routing alpha baseline note for Team knowledge retrieval.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'beta.md'), [
      '# Beta semantic note',
      'domain: team-agents',
      'atoms: team.knowledge-hybrid-rerank',
      '',
      'Lexical common semantic captain vector note for opt-in Team knowledge retrieval.'
    ].join('\n'), 'utf8');

    try {
      const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'coordinator', '--cwd', cwd, '--json']);
      assert.equal(writeBuild.ok, true);

      const lexicalOnly = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--cwd',
        cwd,
        '--json'
      ]);
      const lexicalEvidence = lexicalOnly.evidence as any;
      assert.equal(lexicalOnly.ok, true);
      assert.equal(lexicalEvidence?.hybridRetrieval?.requested, false);
      assert.equal(lexicalEvidence?.hybridRetrieval?.applied, false);

      const missingCache = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--vector-rerank',
        '--cwd',
        cwd,
        '--json'
      ]);
      const missingEvidence = missingCache.evidence as any;
      assert.equal(missingCache.ok, true);
      assert.equal(missingEvidence?.hybridRetrieval?.requested, true);
      assert.equal(missingEvidence?.hybridRetrieval?.applied, false);
      assert.equal(missingEvidence?.hybridRetrieval?.fallback, 'embedding-cache-missing-or-invalid');
      assert.equal(missingEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);

      mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge'), { recursive: true });
      writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-embeddings.json'), `${JSON.stringify({
        schemaId: 'atm.teamKnowledgeEmbeddingCache.v1',
        advisoryOnly: true,
        entries: [
          { path: '.atm/knowledge/team/alpha.md', vector: { alpha: 4, baseline: 1 } },
          { path: '.atm/knowledge/team/beta.md', vector: { captain: 3, vector: 3, semantic: 1 } }
        ]
      }, null, 2)}\n`, 'utf8');

      const reranked = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--vector-rerank',
        '--cwd',
        cwd,
        '--json'
      ]);
      const rerankEvidence = reranked.evidence as any;
      assert.equal(reranked.ok, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.requested, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.applied, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);
      assert.ok(rerankEvidence?.hybridRetrieval?.lexicalShortlistSize >= 2);
      assert.equal(rerankEvidence?.hits?.[0]?.path, '.atm/knowledge/team/beta.md');
      assert.equal(typeof rerankEvidence?.hits?.[0]?.semanticScore, 'number');
      assert.equal(Object.hasOwn(rerankEvidence.hits[0], 'searchText'), false);

      const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--json']);
      const statsEvidence = stats.evidence as any;
      assert.ok(statsEvidence?.embeddingCacheBytes > 0);
      assert.ok(statsEvidence?.runtimeFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/team-knowledge-embeddings.json' && entry.prunable === true));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-hybrid-rerank)');
    return;
  }

  if (taskCase === 'patrol-report') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-patrol');
    const taskId = 'TASK-PATROL-0001';
    const teamRunId = 'team-patrol-fixture';
    const evidenceDriftRunId = 'team-patrol-evidence-drift';
    const evidenceDriftBrokerSubagent = {
      schemaId: 'atm.teamBrokerSubagentContract.v1',
      enabled: true,
      subagentId: 'team-broker-subagent',
      lifecycleOwner: 'atm',
      decisionSurface: 'brokerLane',
      governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
      stewardId: 'neutral-write-steward',
      evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
      authorityBoundary: {
        fileWrite: false,
        gitWrite: false,
        taskLifecycle: false,
        selfClose: false
      },
      escalationTarget: 'coordinator'
    };
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      title: 'Patrol report fixture',
      status: 'running',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      targetAllowedFiles: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case patrol-report'],
      acceptance: ['Patrol output is read-only and reports runtime findings.']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'captain',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      retryBudget: { remaining: 0, limit: 2 },
      reworkRoute: { status: 'needs-rework', retryBudget: { remaining: 0, limit: 2 } },
      runtimeContract: {
        commitLane: {
          schemaId: 'atm.teamCommitLaneContract.v1',
          ownerRole: 'worker',
          workerGitWrite: true,
          serializedBy: 'shared-staging'
        }
      },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${evidenceDriftRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId: evidenceDriftRunId,
      taskId,
      actorId: 'captain',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      brokerSubagent: evidenceDriftBrokerSubagent,
      runtimeContract: {
        brokerSubagent: evidenceDriftBrokerSubagent,
        commitLane: {
          schemaId: 'atm.teamCommitLaneContract.v1',
          ownerRole: 'coordinator',
          workerGitWrite: false,
          serializedBy: 'branch-commit-queue'
        },
        workerAdapter: {
          authorityBoundary: {
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
          }
        }
      },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const beforeHistory = listRelativeFiles(path.join(cwd, '.atm', 'history'));
      const beforeRuntime = listRelativeFiles(path.join(cwd, '.atm', 'runtime'));
      const patrol = await runTeam(['patrol', '--task', taskId, '--team', teamRunId, '--cwd', cwd, '--json']);
      const evidence = patrol.evidence as any;
      assert.equal(patrol.ok, true);
      assert.equal(evidence?.schemaId, 'atm.teamPatrolReport.v1');
      assert.equal(evidence?.action, 'patrol');
      assert.equal(evidence?.readOnly, true);
      assert.equal(evidence?.runtimeWritten, false);
      assert.equal(evidence?.historyWritten, false);
      assert.equal(evidence?.agentsSpawned, false);
      assert.deepEqual(evidence?.mutations, []);
      assert.equal(evidence?.taskId, taskId);
      assert.equal(evidence?.runId, `patrol-${taskId}-claim-preflight`);
      assert.ok(Array.isArray(evidence?.patrolTeam) && evidence.patrolTeam.includes('atomic-police'));
      assert.equal(evidence?.mode, 'claim-preflight');
      assert.equal(evidence?.severity, 'blocker');
      assert.equal(evidence?.safeToProceed, false);
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'broker-governance' && finding.code === 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'broker-governance' && finding.code === 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT' && finding.details?.serializedBy === 'shared-staging' && finding.details?.ownerRole === 'worker' && finding.details?.workerGitWrite === true));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'retry-budget'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'warning' && finding.category === 'rework-state'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.category === 'scope'));
      assert.equal(typeof evidence?.suggestedCommand, 'string');
      assert.ok(Array.isArray(evidence?.followUp) && evidence.followUp.length > 0);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'history')), beforeHistory);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'runtime')), beforeRuntime);

      const evidenceDriftPatrol = await runTeam(['patrol', '--task', taskId, '--team', evidenceDriftRunId, '--cwd', cwd, '--json']);
      const evidenceDrift = evidenceDriftPatrol.evidence as any;
      assert.equal(evidenceDriftPatrol.ok, true);
      assert.equal(evidenceDrift?.severity, 'blocker');
      assert.equal(evidenceDrift?.safeToProceed, false);
      assert.ok(evidenceDrift?.findings?.some((finding: any) => (
        finding.level === 'blocker'
        && finding.category === 'broker-governance'
        && finding.code === 'ATM_TEAM_PATROL_BROKER_EVIDENCE_GATE_DRIFT'
        && finding.details?.missingEvidence?.includes('atm.stewardApplyEvidence.v1')
      )));
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'history')), beforeHistory);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'runtime')), beforeRuntime);

      for (const mode of ['close-preflight', 'big-script', 'daily-noon']) {
        const modeResult = await runTeam(['patrol', '--task', taskId, '--mode', mode, '--cwd', cwd, '--json']);
        const modeEvidence = modeResult.evidence as any;
        assert.equal(modeResult.ok, true);
        assert.equal(modeEvidence?.mode, mode);
        assert.deepEqual(modeEvidence?.mutations, []);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (patrol-report)');
    return;
  }

  if (taskCase === 'team-lifecycle-verbs') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-lifecycle-verbs');
    const taskId = 'TASK-TEAM-LIFECYCLE-0001';
    const teamRunId = 'team-lifecycle-fixture';
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'coordinator',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      leases: [],
      permissionLeases: [],
      teamSummary: {
        decision: 'fixture',
        closeReady: false
      },
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const lease = await runTeam([
        'lease',
        '--team',
        teamRunId,
        '--actor',
        'implementer-typescript',
        '--permission',
        'file.write',
        '--paths',
        'packages/cli/src/commands/team.ts,scripts/validate-team-agents.ts',
        '--reason',
        'validator fixture lease',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(lease.ok, true);
      assert.equal((lease.evidence as any)?.status, 'active');
      assert.equal((lease.evidence as any)?.leaseCount, 1);

      const afterLease = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), 'utf8'));
      assert.equal(afterLease.permissionLeases.length, 1);
      assert.equal(afterLease.permissionLeases[0].permission, 'file.write');
      assert.equal(afterLease.permissionLeases[0].agentId, 'implementer-typescript');
      assert.deepEqual(afterLease.permissionLeases[0].paths, [
        'packages/cli/src/commands/team.ts',
        'scripts/validate-team-agents.ts'
      ]);
      assert.equal(afterLease.lifecycleEvents[0].type, 'lease.granted');

      const release = await runTeam([
        'release',
        '--team',
        teamRunId,
        '--actor',
        'implementer-typescript',
        '--permission',
        'file.write',
        '--reason',
        'validator fixture release',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(release.ok, true);
      assert.equal((release.evidence as any)?.leaseCount, 0);

      const complete = await runTeam([
        'complete',
        '--team',
        teamRunId,
        '--actor',
        'coordinator',
        '--reason',
        'validator fixture complete',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(complete.ok, true);
      assert.equal((complete.evidence as any)?.status, 'completed');
      assert.equal((complete.evidence as any)?.teamRun?.status, 'completed');
      assert.equal(typeof (complete.evidence as any)?.teamRun?.completedAt, 'string');

      const finalRun = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), 'utf8'));
      assert.equal(finalRun.status, 'completed');
      assert.equal(finalRun.completedBy, 'coordinator');
      assert.equal(finalRun.teamSummary.closeReady, true);
      assert.deepEqual(finalRun.lifecycleEvents.map((event: any) => event.type), [
        'lease.granted',
        'lease.released',
        'team.completed'
      ]);

      const postCompleteBlocked = await assertRejectsCliError(
        () => runTeam(['abandon', '--team', teamRunId, '--actor', 'coordinator', '--cwd', cwd, '--json']),
        'ATM_TEAM_RUN_NOT_ACTIVE'
      );
      assert.equal(postCompleteBlocked.details?.status, 'completed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (team-lifecycle-verbs)');
    return;
  }

  if (taskCase === 'team-required-close-gate') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-required-close-gate');
    const taskId = 'TASK-TEAM-REQUIRED-0001';
    const teamRunId = 'team-required-fixture';
    const taskDocument = {
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      status: 'running',
      team: { required: true }
    };
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });

    try {
      const missing = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
      assert.equal(missing.ok, false);
      assert.equal(missing.required, true);
      assert.ok(missing.requiredCommand?.includes('team complete'));

      writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
        schemaId: 'atm.teamRun.v1',
        teamRunId,
        taskId,
        actorId: 'coordinator',
        status: 'active',
        teamSummary: { closeReady: false },
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z'
      }, null, 2)}\n`, 'utf8');
      const activeOnly = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
      assert.equal(activeOnly.ok, false);

      const complete = await runTeam([
        'complete',
        '--team',
        teamRunId,
        '--actor',
        'coordinator',
        '--reason',
        'required close gate fixture',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(complete.ok, true);
      const ready = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
      assert.equal(ready.ok, true);
      assert.equal((ready.teamRun as any)?.teamRunId, teamRunId);
      assert.equal((ready.teamRun as any)?.status, 'completed');

      const notRequired = evaluateTeamRequiredCompletionGate({
        cwd,
        taskId: 'TASK-NO-TEAM',
        taskDocument: { schemaId: 'atm.taskLedger.v1', workItemId: 'TASK-NO-TEAM', status: 'running' }
      });
      assert.equal(notRequired.ok, true);
      assert.equal(notRequired.required, false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (team-required-close-gate)');
    return;
  }

  if (taskCase === 'hook-team-gate') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-hook-team-gate');
    const teamRunId = 'team-hook-fixture';
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId: 'TASK-HOOK-TEAM-0001',
      actorId: 'coordinator',
      status: 'active',
      permissionLeases: [
        { permission: 'git.write', agentId: 'coordinator' },
        { permission: 'file.write', agentId: 'implementer-typescript', paths: ['packages/cli/src/commands/team.ts'] }
      ],
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const allowedTool = evaluateTeamPreToolGate({
        cwd,
        actorId: 'implementer-typescript',
        files: ['packages/cli/src/commands/team.ts'],
        command: null,
        toolName: 'apply_patch'
      });
      assert.equal(allowedTool.length, 0);

      const blockedTool = evaluateTeamPreToolGate({
        cwd,
        actorId: 'implementer-typescript',
        files: ['scripts/validate-team-agents.ts'],
        command: null,
        toolName: 'apply_patch'
      });
      assert.equal(blockedTool.length, 1);
      assert.equal(blockedTool[0].code, 'ATM_TEAM_WRITE_SCOPE_EXCEEDED');
      assert.equal(blockedTool[0].teamRunId, teamRunId);

      const integrationBlocked = runIntegrationHookInvocationInProcess([
        'pre-tool',
        '--editor',
        'codex',
        '--tool-name',
        'apply_patch',
        '--files',
        'scripts/validate-team-agents.ts',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(integrationBlocked.ok, false);
      assert.equal(integrationBlocked.messages[0]?.code, 'ATM_TEAM_WRITE_SCOPE_EXCEEDED');

      writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', 'team-hook-fixture-secondary.json'), `${JSON.stringify({
        schemaId: 'atm.teamRun.v1',
        teamRunId: 'team-hook-fixture-secondary',
        taskId: 'TASK-HOOK-TEAM-0002',
        actorId: 'coordinator',
        status: 'active',
        permissionLeases: [
          { permission: 'git.write', agentId: 'coordinator' }
        ],
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z'
      }, null, 2)}\n`, 'utf8');

      const blockedCommit = evaluateTeamPreCommitGate({
        cwd,
        actorId: 'implementer-typescript',
        stagedFiles: ['packages/cli/src/commands/team.ts']
      });
      assert.equal(blockedCommit.length, 1);
      assert.equal(blockedCommit[0].code, 'ATM_TEAM_GIT_OWNER_REQUIRED');
      assert.deepEqual(blockedCommit[0].teamRunIds, ['team-hook-fixture']);
      assert.deepEqual(blockedCommit[0].files, ['packages/cli/src/commands/team.ts']);
      assert.deepEqual(blockedCommit[0].relevantFiles, ['packages/cli/src/commands/team.ts']);

      const unrelatedCommit = evaluateTeamPreCommitGate({
        cwd,
        actorId: 'implementer-typescript',
        stagedFiles: ['scripts/validate-team-agents.ts']
      });
      assert.equal(unrelatedCommit.length, 0, 'unrelated active Team runs must not block a framework commit outside their file.write lease');

      const allowedCommit = evaluateTeamPreCommitGate({
        cwd,
        actorId: 'coordinator',
        stagedFiles: ['packages/cli/src/commands/team.ts']
      });
      assert.equal(allowedCommit.length, 0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (hook-team-gate)');
    return;
  }

  if (taskCase === 'capture-broker-evidence') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-capture-broker-evidence');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });

    const runDir = path.join(cwd, '.atm', 'history', 'evidence', 'broker-runs');
    const teamRunDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
    const outputDir = path.join(cwd, 'capture-output');
    const commandOutput = path.join(cwd, 'command-output');

    mkdirSync(runDir, { recursive: true });
    mkdirSync(teamRunDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const baselineRun = path.join(runDir, 'baseline.json');
    const baselineRunPayload = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: 'run-baseline-1',
      planId: 'plan-baseline-1',
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
          actor_ids: ['codex'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'applied',
          merge_verdict: 'applied',
          evidence_path: 'evidence/baseline.json',
          task_ids: ['TASK-TEAM-0042'],
          commit_sha: 'baselinecommit',
          transaction_ids: ['txn-baseline-1']
        }
      ]
    };
    writeFileSync(baselineRun, `${JSON.stringify(baselineRunPayload, null, 2)}\n`, 'utf8');

    const collectResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--run-ids',
        'run-baseline-1',
        '--output-dir',
        outputDir,
        '--json-output',
        path.join(outputDir, 'filter-broker-capture.json'),
        '--report-output',
        path.join(outputDir, 'filter-broker-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(collectResult.status, 0, collectResult.stderr || collectResult.stdout);
    const filtered = JSON.parse(readFileSync(path.join(outputDir, 'filter-broker-capture.json'), 'utf8')) as {
      runs?: Array<{
        runId: string;
        requiredFields?: string[];
      }>;
    };
    assert.equal(filtered.runs?.length, 1, 'filtered run capture should keep baseline run');
    assert.equal(filtered.runs?.[0]?.runId, 'run-baseline-1');
    assert.ok(
      Array.isArray(filtered.runs?.[0]?.requiredFields),
      'requiredFields should be collected for schema audit'
    );

    const teamRunPath = path.join(teamRunDir, 'team-capture-1.json');
    writeFileSync(teamRunPath, `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      specVersion: '0.1.0',
      teamRunId: 'team-capture-1',
      taskId: 'TASK-TEAM-0042',
      actorId: 'codex',
      planId: 'bench:B-12:TASK-TEAM-0042:team-run',
      brokerLane: {
        chosenLane: 'queued',
        decision: {
          lane: 'queued',
          verdict: 'blocked'
        },
        writeIntent: {
          requestIdentity: 'bench:B-12:TASK-TEAM-0042:team-run',
          actorId: 'codex',
          requestFiles: ['packages/cli/src/commands/team.ts'],
          baseCommit: 'teamrunbase'
        },
        writeTransaction: {
          transactionId: 'txn-team-run-1',
          writeSet: ['packages/cli/src/commands/team.ts']
        }
      }
    }, null, 2)}\n`, 'utf8');

    const teamCaptureResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--team-run-dir',
        teamRunDir,
        '--task-ids',
        'TASK-TEAM-0042',
        '--output-dir',
        path.join(cwd, 'capture-output-team-run'),
        '--json-output',
        path.join(cwd, 'capture-output-team-run', 'team-broker-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-team-run', 'team-broker-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(teamCaptureResult.status, 0, teamCaptureResult.stderr || teamCaptureResult.stdout);
    const teamCaptured = JSON.parse(readFileSync(path.join(cwd, 'capture-output-team-run', 'team-broker-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; scenario: string; lane: string; verdict: string; transactions: string; files: string }>;
      sourceTeamRunDirs?: string[];
    };
    const teamCapturedRow = teamCaptured.runs?.find((row) => row.runId === 'team-capture-1');
    assert.ok(teamCapturedRow, 'team-run brokerLane should be captured as a run row');
    assert.equal(teamCapturedRow?.scenario, 'B-12');
    assert.equal(teamCapturedRow?.lane, 'queued');
    assert.equal(teamCapturedRow?.verdict, 'blocked');
    assert.ok(teamCapturedRow?.transactions.includes('txn-team-run-1'));
    assert.ok(teamCapturedRow?.files.includes('packages/cli/src/commands/team.ts'));
    assert.ok(teamCaptured.sourceTeamRunDirs?.[0]?.includes('team-runs'));

    const teamCollectResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'collect-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--team-run-dir',
        teamRunDir,
        '--task-ids',
        'TASK-TEAM-0042',
        '--output-dir',
        path.join(cwd, 'collect-output-team-run')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(teamCollectResult.status, 0, teamCollectResult.stderr || teamCollectResult.stdout);
    const teamCollected = JSON.parse(readFileSync(path.join(cwd, 'collect-output-team-run', 'broker-evidence-bundle.json'), 'utf8')) as {
      runs?: Array<{ runId: string; scenario: string; lane: string; verdict: string }>;
      sourceTeamRunDir?: string;
    };
    const teamCollectedRow = teamCollected.runs?.find((row) => row.runId === 'team-capture-1');
    assert.ok(teamCollectedRow, 'collect-broker-evidence should include team-run brokerLane row');
    assert.equal(teamCollectedRow?.scenario, 'B-12');
    assert.equal(teamCollectedRow?.lane, 'queued');
    assert.equal(teamCollectedRow?.verdict, 'blocked');
    assert.ok(teamCollected.sourceTeamRunDir?.includes('team-runs'));

    const writerPath = path.join(commandOutput, 'write-run.cjs');
    mkdirSync(commandOutput, { recursive: true });
    const awaitedRun = path.join(runDir, 'run-await-1.json');
    const awaitedRunPayload = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: 'run-await-1',
      planId: 'plan-await-1',
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0043:close-orch'],
          actor_ids: ['cursor'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/await.json',
          task_ids: ['TASK-TEAM-0043'],
          commit_sha: 'awaitcommit',
          transaction_ids: ['txn-await-1']
        }
      ]
    };
    const writerSource = `const fs = require('fs');\nconst path = process.argv[2];\nconst payload = ${JSON.stringify(awaitedRunPayload, null, 2)};\nconst delay = Number(process.argv[3] ?? 0);\nsetTimeout(() => { fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\\n', 'utf8'); }, delay);\n`;
    writeFileSync(writerPath, writerSource, 'utf8');

    const awaitResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--command',
        `node "${writerPath.replace(/\\\\/g, '/')}" "${awaitedRun.replace(/\\\\/g, '/')}" 200`,
        '--await-new',
        '1',
        '--timeout-ms',
        '5000',
        '--poll-ms',
        '250',
        '--output-dir',
        path.join(cwd, 'capture-output-await'),
        '--json-output',
        path.join(cwd, 'capture-output-await', 'run-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-await', 'run-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(awaitResult.status, 0, awaitResult.stderr || awaitResult.stdout);

    const awaited = JSON.parse(readFileSync(path.join(cwd, 'capture-output-await', 'run-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; lane: string; verdict: string }>;
      commandLog?: Array<{ command: string; exitCode: number }>;
    };
    assert.equal(awaited.runs?.length, 1, 'await new should capture newly generated broker run');
    assert.equal(awaited.runs?.[0]?.runId, 'run-await-1');
    assert.equal(awaited.runs?.[0]?.lane, 'queued');
    assert.equal(awaited.runs?.[0]?.verdict, 'conflict');
    assert.equal(awaited.commandLog?.length, 1);
    assert.equal(awaited.commandLog?.[0]?.exitCode, 0);

    const parallelStamp = `run-parallel-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const runParallelA = path.join(runDir, `${parallelStamp}-a.json`);
    const runParallelB = path.join(runDir, `${parallelStamp}-b.json`);
    const parallelPayloadA = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: `${parallelStamp}-a`,
      planId: `${parallelStamp}-plan-a`,
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
          actor_ids: ['codex'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/parallel-a.json',
          task_ids: ['TASK-TEAM-0042'],
          commit_sha: 'parallel-a',
          transaction_ids: ['txn-parallel-a']
        }
      ]
    };
    const parallelPayloadB = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: `${parallelStamp}-b`,
      planId: `${parallelStamp}-plan-b`,
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0043:close-orch'],
          actor_ids: ['cursor'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/parallel-b.json',
          task_ids: ['TASK-TEAM-0043'],
          commit_sha: 'parallel-b',
          transaction_ids: ['txn-parallel-b']
        }
      ]
    };
    const writerParallelSource = `const fs = require('fs');\nconst path = process.argv[2];\nconst payloadPath = process.argv[3];\nconst delay = Number(process.argv[4] ?? 0);\nconst payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));\nsetTimeout(() => { fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\\n', 'utf8'); }, delay);\n`;
    const writerParallelPathA = path.join(commandOutput, 'write-parallel-a.cjs');
    const writerParallelPathB = path.join(commandOutput, 'write-parallel-b.cjs');
    writeFileSync(writerParallelPathA, writerParallelSource, 'utf8');
    writeFileSync(writerParallelPathB, writerParallelSource, 'utf8');
    const payloadPathA = path.join(commandOutput, 'payload-parallel-a.json');
    const payloadPathB = path.join(commandOutput, 'payload-parallel-b.json');
    writeFileSync(payloadPathA, `${JSON.stringify(parallelPayloadA)}\n`, 'utf8');
    writeFileSync(payloadPathB, `${JSON.stringify(parallelPayloadB)}\n`, 'utf8');
    rmSync(runParallelA, { force: true });
    rmSync(runParallelB, { force: true });

    const awaitParallelResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--command',
        `node "${writerParallelPathA.replace(/\\\\/g, '/')}" "${runParallelA.replace(/\\\\/g, '/')}" "${payloadPathA.replace(/\\\\/g, '/')}" 500`,
        '--command',
        `node "${writerParallelPathB.replace(/\\\\/g, '/')}" "${runParallelB.replace(/\\\\/g, '/')}" "${payloadPathB.replace(/\\\\/g, '/')}" 500`,
        '--await-new',
        '2',
        '--timeout-ms',
        '5000',
        '--poll-ms',
        '250',
        '--output-dir',
        path.join(cwd, 'capture-output-parallel'),
        '--json-output',
        path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(awaitParallelResult.status, 0, awaitParallelResult.stderr || awaitParallelResult.stdout);

    const awaitedParallel = JSON.parse(readFileSync(path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; lane: string; verdict: string }>;
      commandLog?: Array<{ command: string; exitCode: number; signal?: string | null; durationMs?: number }>;
    };
    assert.equal(awaitedParallel.runs?.length, 2, 'await new should capture two parallel generated broker runs');
    assert.equal(awaitedParallel.commandLog?.length, 2, 'parallel commands should be tracked');
    assert.equal(awaitedParallel.commandLog?.[0]?.exitCode, 0);
    assert.equal(awaitedParallel.commandLog?.[1]?.exitCode, 0);
    assert.ok(awaitedParallel.commandLog?.[0]?.durationMs && awaitedParallel.commandLog?.[1]?.durationMs);

    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (capture-broker-evidence)');
    return;
  }

  fail(`unsupported or missing --case value: ${taskCase}`);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function waveCard(over: Partial<WaveCandidateCard> & { taskId: string }): WaveCandidateCard {
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

function scopeLease(over: Partial<ScopeLeaseRegistryEntry> & { leaseId: string }): ScopeLeaseRegistryEntry {
  return {
    leaseId: over.leaseId,
    taskId: over.taskId ?? 'TASK-TEAM-0018',
    resourceKey: over.resourceKey ?? 'packages/cli/src/commands/team.ts',
    owner: over.owner ?? { instanceId: 'agent-a', worktreeId: 'wt-a' },
    runMode: over.runMode ?? 'real-agent',
    leaseEpoch: over.leaseEpoch ?? 1,
    status: over.status ?? 'active',
    allowedFiles: over.allowedFiles ?? ['packages/cli/src/commands/team.ts'],
    writeSet: over.writeSet ?? ['packages/cli/src/commands/team.ts'],
    ...(over.waitsFor ? { waitsFor: over.waitsFor } : {}),
    ...(over.releasedAt ? { releasedAt: over.releasedAt } : {})
  };
}

function validateWaveMode(): void {
  // Safe wave: disjoint cards plan into one wave and admit fully.
  const safePlan = planWaves({ cards: [waveCard({ taskId: 'T-A' }), waveCard({ taskId: 'T-B' })] });
  if (safePlan.waves.length !== 1) fail('wave-mode: safe wave must plan into one wave');
  const safe = admitWave({ members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B' }) }] });
  if (!safe.ok || safe.admitted.length !== 2) fail('wave-mode: safe wave must admit all members');

  // Unsafe wave: same deliverable fails closed.
  const unsafe = admitWave({
    members: [
      { card: waveCard({ taskId: 'T-A', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) },
      { card: waveCard({ taskId: 'T-B', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) }
    ]
  });
  if (unsafe.admitted.length !== 1 || unsafe.rejected.length !== 1) {
    fail('wave-mode: unsafe wave must reject the conflicting member');
  }

  // Mixed wave: dependency-blocked member is deferred.
  const mixed = admitWave({
    members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B', dependencies: ['T-OPEN'] }) }]
  });
  if (!mixed.admitted.includes('T-A') || !mixed.rejected.some((r) => r.taskId === 'T-B')) {
    fail('wave-mode: mixed wave must admit ready and defer blocked members');
  }

  // Envelope: validates and enforces disjoint deliverables.
  const env = createTeamWaveEnvelope({
    coordinatorActorId: 'coordinator',
    targetRepo: 'repo-x',
    closureAuthority: 'target_repo',
    waveIndex: 0,
    members: [
      { taskId: 'T-A', workerActorId: null, scopePaths: ['a.ts'], deliverables: ['a.ts'], patchEnvelopeId: null },
      { taskId: 'T-B', workerActorId: null, scopePaths: ['b.ts'], deliverables: ['b.ts'], patchEnvelopeId: null }
    ]
  });
  if (!validateTeamWaveEnvelope(env).ok) fail('wave-mode: clean wave envelope must validate');

  // TASK-MAO-0032: validator / reviewer Team Agents roles are advisory — only the
  // coordinator may perform privileged git / closeout / checkpoint actions.
  if (!assertCoordinatorOnly('coordinator', 'task-closeout').allowed) {
    fail('wave-mode: coordinator must be allowed to drive closeout');
  }
  const advisoryRoles: WaveRole[] = ['worker', 'validator', 'reviewer'];
  for (const role of advisoryRoles) {
    if (assertCoordinatorOnly(role, 'git-write').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed git-write`);
    }
    if (assertCoordinatorOnly(role, 'task-closeout').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed task-closeout`);
    }
  }

  console.log('[validate-team-agents] wave-mode checks ok (safe / unsafe / mixed / envelope / roles)');
}

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    stewardId: null,
    composerPath: null
  };
}

function listRelativeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const relative = path.relative(root, fullPath).replace(/\\/g, '/');
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function assertBrokerRunScanIndex(): void {
  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-broker-run-scan-index');
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });

  const runDir = path.join(cwd, 'broker-runs');
  const logPath = path.join(cwd, 'broker-run-log.md');
  const indexPath = path.join(cwd, 'broker-run-index.json');
  const reportPath = path.join(cwd, 'broker-run-report.md');
  mkdirSync(runDir, { recursive: true });

  const fixtureEnvelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'broker run scan fixture' },
    runId: 'run-scan-1',
    planId: 'plan-scan-1',
    records: [
      {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'broker run scan fixture' },
        runId: 'run-scan-1',
        planId: 'plan-scan-1',
        request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
        actor_ids: ['codex', 'cursor'],
        request_files: ['packages/cli/src/commands/team.ts'],
        applied_files: ['packages/cli/src/commands/team.ts'],
        adapter_choice: 'text-range',
        lane_decision: 'queued',
        merge_verdict: 'conflict',
        evidence_path: '.atm/history/evidence/broker-runs/run-scan-1.json',
        task_ids: ['TASK-TEAM-0042', 'TASK-TEAM-0043'],
        commit_sha: 'deadbeef1234',
        transaction_ids: ['txn-a', 'txn-b']
      }
    ]
  };
  writeFileSync(path.join(runDir, 'run-scan-1.json'), `${JSON.stringify(fixtureEnvelope, null, 2)}\n`, 'utf8');

  const result = spawnSync(
    process.execPath,
    [
      '--strip-types',
        path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
        '--run-dir',
        runDir,
        '--log-file',
        logPath,
        '--report-output',
        reportPath,
        '--json-output',
        indexPath,
        '--compact'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const logText = readFileSync(logPath, 'utf8');
  assert.ok(logText.includes('| runId | planId | requestCount | actorCount | scenarioTags | requestIdentities | actors | taskHints | files | tasks | commits | transactions | adapter | lane | verdict | evidence |'));
  assert.ok(logText.includes('bench:B-12:TASK-TEAM-0042:close-orch'));
  assert.ok(logText.includes('codex,cursor'));
  assert.ok(logText.includes('TASK-TEAM-0042,TASK-TEAM-0043'));
  assert.ok(logText.includes('deadbeef1234'));
  assert.ok(logText.includes('txn-a,txn-b'));

  const reportText = readFileSync(reportPath, 'utf8');
  assert.ok(reportText.includes('| runId | scenario | task | actor | shared files | lane | verdict |'));
  assert.ok(reportText.includes('| run-scan-1 | B-12 | TASK-TEAM-0042 | codex,cursor | packages/cli/src/commands/team.ts | queued | conflict |'));

  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    schemaId?: string;
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(index.schemaId, 'atm.brokerRunScanIndex.v1');
  assert.equal(index.runs?.length, 1);
  assert.equal(index.runs?.[0]?.requestIdentities, 'bench:B-12:TASK-TEAM-0042:close-orch');
  assert.equal(index.runs?.[0]?.actors, 'codex,cursor');
  assert.equal(index.runs?.[0]?.lane, 'queued');
  assert.equal(index.runs?.[0]?.verdict, 'conflict');

  const repoLocalCwd = path.join(cwd, 'repo-local-default');
  const repoLocalRunDir = path.join(repoLocalCwd, '.atm', 'history', 'evidence', 'broker-runs');
  const repoLocalLogPath = path.join(repoLocalCwd, '.atm', 'history', 'evidence', 'CID-Conflict-Run-Log.md');
  const repoLocalCaptureDir = path.join(repoLocalRunDir, 'broker-capture');
  const repoLocalCollectDir = path.join(repoLocalRunDir, 'broker-evidence-bundle');
  mkdirSync(repoLocalRunDir, { recursive: true });

  const repoLocalEnvelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'repo-local default resolution fixture' },
    runId: 'run-local-default-1',
    planId: 'plan-local-default-1',
    records: [
      {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'repo-local default resolution fixture' },
        runId: 'run-local-default-1',
        planId: 'plan-local-default-1',
        request_identity: ['bench:B-12:TASK-TEAM-LOCAL-DEFAULT:scan'],
        actor_ids: ['codex-local'],
        request_files: ['packages/cli/src/commands/team.ts'],
        applied_files: ['packages/cli/src/commands/team.ts'],
        adapter_choice: 'text-range',
        lane_decision: 'applied',
        merge_verdict: 'mergeable',
        evidence_path: '.atm/history/evidence/broker-runs/run-local-default-1.json',
        task_ids: ['TASK-TEAM-LOCAL-DEFAULT'],
        commit_sha: 'feedface5678',
        transaction_ids: ['txn-local-default-1']
      }
    ]
  };
  writeFileSync(path.join(repoLocalRunDir, 'run-local-default-1.json'), `${JSON.stringify(repoLocalEnvelope, null, 2)}\n`, 'utf8');

  const repoLocalScan = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
      '--compact'
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalScan.status, 0, repoLocalScan.stderr || repoLocalScan.stdout);
  assert.equal(existsSync(repoLocalLogPath), true, 'scan-broker-runs without --run-dir must write to repo-local evidence log');
  const repoLocalLogText = readFileSync(repoLocalLogPath, 'utf8');
  assert.ok(repoLocalLogText.includes('run-local-default-1'));
  assert.ok(repoLocalLogText.includes('txn-local-default-1'));

  const repoLocalCollect = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'collect-broker-evidence.ts'),
      '--output-dir',
      repoLocalCollectDir
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalCollect.status, 0, repoLocalCollect.stderr || repoLocalCollect.stdout);
  const repoLocalBundle = JSON.parse(readFileSync(path.join(repoLocalCollectDir, 'broker-evidence-bundle.json'), 'utf8')) as {
    sourceRunDir?: string;
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(repoLocalBundle.sourceRunDir, repoLocalRunDir.replace(/\\/g, '/'));
  assert.ok(repoLocalBundle.runs?.some((run) => run.runId === 'run-local-default-1'));

  const repoLocalCapture = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
      '--run-ids',
      'run-local-default-1',
      '--output-dir',
      repoLocalCaptureDir,
      '--strict',
      'false'
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalCapture.status, 0, repoLocalCapture.stderr || repoLocalCapture.stdout);
  const repoLocalCaptured = JSON.parse(readFileSync(path.join(repoLocalCaptureDir, 'broker-capture.json'), 'utf8')) as {
    sourceRunDirs?: string[];
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(repoLocalCaptured.sourceRunDirs?.[0], repoLocalRunDir.replace(/\\/g, '/'));
  assert.ok(repoLocalCaptured.runs?.some((run) => run.runId === 'run-local-default-1'));

  const realRunDir = path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'broker-collision-evidence',
    'runs'
  );
  if (existsSync(realRunDir)) {
    const realIndexPath = path.join(cwd, 'broker-run-index-real.json');
    const realReportPath = path.join(cwd, 'broker-run-report-real.md');
    const realResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
        '--run-dir',
        realRunDir,
        '--log-file',
        logPath,
        '--report-output',
        realReportPath,
        '--json-output',
        realIndexPath,
        '--compact'
      ],
      { encoding: 'utf8' }
    );
    assert.equal(realResult.status, 0, realResult.stderr || realResult.stdout);
    const realIndex = JSON.parse(readFileSync(realIndexPath, 'utf8')) as {
      runs?: Array<Record<string, unknown>>;
    };
    assert.ok(realIndex.runs?.some((run) => run.runId === '67b193f9-1244-4e41-9f64-1ebbdbeaa9e5'));
    assert.ok(realIndex.runs?.some((run) => run.runId === 'c393df1d-f9ab-4331-ac3e-3182df57ac45'));
    assert.ok(realIndex.runs?.some((run) => String(run.requestIdentities ?? '').includes('REQ-0041-EVIDENCE-GATES')));
    assert.ok(realIndex.runs?.some((run) => String(run.actors ?? '').includes('cursor-composer-2.5')));
    assert.ok(existsSync(realReportPath));
  }

  rmSync(cwd, { recursive: true, force: true });
}

function writeTeamRunForHandoffGate(cwd: string, taskId: string, teamRunId: string): void {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${teamRunId}.json`), `${JSON.stringify({
    schemaId: 'atm.teamRun.v1',
    taskId,
    teamRunId,
    actorId: 'bound-captain',
    status: 'active',
    roles: [{ agentId: 'coordinator', role: 'coordinator', permissions: ['handoff.read', 'handoff.materialize'] }],
    permissionLeases: [
      { permission: 'handoff.read', agentId: 'coordinator', paths: ['packages/core/src/team-runtime/handoff-ledger.ts'] },
      { permission: 'handoff.materialize', agentId: 'coordinator', paths: ['packages/core/src/team-runtime/handoff-ledger.ts'] }
    ]
  }, null, 2)}\n`, 'utf8');
}

function fail(message: string): never {
  console.error(`[validate-team-agents] ${message}`);
  process.exit(1);
}

function snapshotSourceTeamRunFiles(cwd: string): Set<string> {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) return new Set();
  return new Set(readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(directory, entry)));
}

function cleanupNewSourceTeamRunFiles(cwd: string, before: Set<string>): void {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(directory, entry);
    if (before.has(filePath)) continue;
    rmSync(filePath, { force: true });
  }
}

async function assertRejectsCliError(action: () => Promise<unknown>, code: string): Promise<CliError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof CliError, `expected CliError ${code}, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected CliError ${code}`);
}
