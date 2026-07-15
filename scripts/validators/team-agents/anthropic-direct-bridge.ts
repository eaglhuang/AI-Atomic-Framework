import assert from 'node:assert/strict';

import { buildAnthropicRuntimeBridgeSummary } from '../../../packages/cli/src/commands/team.ts';
import { createDefaultTeamPermissionPolicy } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import { TEAM_PROVIDER_IDS } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import {
  createAnthropicTeamProviderBridge,
  launchAnthropicTeamProviderRun,
  validateAnthropicTeamProviderConfig
} from '../../../packages/core/src/team-runtime/providers/anthropic.ts';

export async function runAnthropicDirectBridgeValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'anthropic-direct-bridge') return false;

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
  return true;
}
