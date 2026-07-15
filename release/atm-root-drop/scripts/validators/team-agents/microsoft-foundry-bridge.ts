import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildMicrosoftFoundryRuntimeBridgeSummary, runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createDefaultTeamPermissionPolicy } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import { createMicrosoftFoundryTeamProviderBridge, launchMicrosoftFoundryTeamProviderRun, validateMicrosoftFoundryTeamProviderConfig } from '../../../packages/core/src/team-runtime/providers/microsoft-foundry.ts';

function findingsMatchTransientGovernanceCodes(findings: readonly any[], allowedCodes: readonly string[]): boolean {
  if (findings.length === 0) return true;
  const actualCodes = findings.map((finding) => String(finding?.code ?? '')).sort();
  const expectedCodes = [...allowedCodes].sort();
  return actualCodes.length === expectedCodes.length
    && actualCodes.every((code, index) => code === expectedCodes[index]);
}

export async function runMicrosoftFoundryBridgeValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'microsoft-foundry-bridge') return false;

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
    const agentMetadata = foundryCalls[1]?.body?.metadata;
    assert.equal(agentMetadata?.scopedPathCount, '1');
    assert.ok(Object.values(agentMetadata ?? {}).every((value) => typeof value === 'string'));

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
    const onlyBrokerAdmissionFinding = findingsMatchTransientGovernanceCodes(findings, [
      'blocked-broker-cid-conflict',
      'proposal-first-required'
    ]);
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating Foundry bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.microsoftFoundryRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['microsoft-foundry']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.microsoftFoundryTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('project-chat-inference'));
    assert.ok(vendorRuntimeDoc.includes('agent-service'));
    assert.equal(
      existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'providers', 'microsoft-foundry.ts')),
      true,
      'Foundry provider source should exist for runtime bridge validation'
    );

    console.log('[validate-team-agents] ok (microsoft-foundry-bridge)');
    return true;
}
