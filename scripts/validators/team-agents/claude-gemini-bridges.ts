import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildEditorExecutionRuntimeBridgeSummary, runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createDefaultTeamPermissionPolicy } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import { createClaudeCodeTeamProviderBridge, launchClaudeCodeTeamProviderRun, validateClaudeCodeTeamProviderConfig } from '../../../packages/core/src/team-runtime/providers/claude-code.ts';
import { createGeminiTeamProviderBridge, launchGeminiTeamProviderRun, validateGeminiTeamProviderConfig } from '../../../packages/core/src/team-runtime/providers/gemini.ts';

function findingsMatchTransientGovernanceCodes(findings: readonly any[], allowedCodes: readonly string[]): boolean {
  if (findings.length === 0) return true;
  const actualCodes = findings.map((finding) => String(finding?.code ?? '')).sort();
  const expectedCodes = [...allowedCodes].sort();
  return actualCodes.length === expectedCodes.length
    && actualCodes.every((code, index) => code === expectedCodes[index]);
}

export async function runClaudeGeminiBridgesValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'claude-gemini-bridges') return false;

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
    const onlyBrokerAdmissionFinding = findingsMatchTransientGovernanceCodes(findings, [
      'blocked-broker-cid-conflict',
      'proposal-first-required'
    ]);
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating Claude/Gemini bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.editorExecutionRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['claude-code', 'gemini']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.claudeCodeTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.geminiTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.teamEditorSubagentRoleEnvelope.v1'));
    assert.equal(
      existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'providers', 'claude-code.ts')),
      true,
      'Claude Code provider source should exist for runtime bridge validation'
    );
    assert.equal(
      existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'providers', 'gemini.ts')),
      true,
      'Gemini provider source should exist for runtime bridge validation'
    );

    console.log('[validate-team-agents] ok (claude-gemini-bridges)');
    return true;
}
