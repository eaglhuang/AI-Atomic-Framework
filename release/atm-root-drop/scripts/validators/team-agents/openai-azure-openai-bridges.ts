import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildOpenAIFamilyRuntimeBridgeSummary, runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createDefaultTeamPermissionPolicy } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import { createAzureOpenAITeamProviderBridge, launchAzureOpenAITeamProviderRun, validateAzureOpenAITeamProviderConfig } from '../../../packages/core/src/team-runtime/providers/azure-openai.ts';
import { createOpenAITeamProviderBridge, launchOpenAITeamProviderRun, validateOpenAITeamProviderConfig } from '../../../packages/core/src/team-runtime/providers/openai.ts';

function findingsMatchTransientGovernanceCodes(findings: readonly any[], allowedCodes: readonly string[]): boolean {
  if (findings.length === 0) return true;
  const actualCodes = findings.map((finding) => String(finding?.code ?? '')).sort();
  const expectedCodes = [...allowedCodes].sort();
  return actualCodes.length === expectedCodes.length
    && actualCodes.every((code, index) => code === expectedCodes[index]);
}

export async function runOpenAIAzureOpenAIBridgesValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'openai-azure-openai-bridges') return false;

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
    const azureMetadata = httpCalls[1]?.body?.metadata;
    assert.equal(azureMetadata?.scopedPathCount, '1');
    assert.ok(Object.values(azureMetadata ?? {}).every((value) => typeof value === 'string'));
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
    const onlyBrokerAdmissionFinding = findingsMatchTransientGovernanceCodes(findings, [
      'blocked-broker-cid-conflict',
      'proposal-first-required'
    ]);
    assert.equal(planResult.ok === true || onlyBrokerAdmissionFinding, true, 'plan may be blocked only by active broker admission while validating OpenAI bridge wiring');
    assert.equal(planBridgeSummary?.schemaId, 'atm.openAIFamilyRuntimeBridgeSummary.v1');
    assert.deepEqual(planBridgeSummary?.providerIds, ['openai', 'azure-openai']);

    const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
    assert.ok(vendorRuntimeDoc.includes('atm.openaiTeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.azureOpenAITeamProviderConfig.v1'));
    assert.ok(vendorRuntimeDoc.includes('atm.teamProviderRunArtifact.v1'));
    assert.equal(
      existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'providers', 'openai.ts')),
      true,
      'OpenAI provider source should exist for runtime bridge validation'
    );
    assert.equal(
      existsSync(path.join(process.cwd(), 'packages', 'core', 'src', 'team-runtime', 'providers', 'azure-openai.ts')),
      true,
      'Azure OpenAI provider source should exist for runtime bridge validation'
    );

    console.log('[validate-team-agents] ok (openai-azure-openai-bridges)');
    return true;
}
