import assert from 'node:assert/strict';
import {
  buildDirectTeamRoleInstructions,
  runDirectTeamProviderRole,
  runTeamProviderExecution
} from '../../../packages/cli/src/commands/team.ts';
import {
  TEAM_DIRECT_API_PROVIDER_IDS,
  TEAM_PROVIDER_IDS
} from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { createDefaultTeamPermissionPolicy } from '../../../packages/core/src/team-runtime/permission-broker.ts';
import {
  createGeminiDirectTeamProviderBridge,
  launchGeminiDirectTeamProviderRun
} from '../../../packages/core/src/team-runtime/providers/gemini-direct.ts';

export async function runThreeVendorDirectArtifactHandoffValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'three-vendor-direct-artifact-handoff' && taskCase !== 'gemini-direct-api-bridge') {
    return false;
  }
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
  assert.ok(bounded.telemetry.actualTokenCount <= 256);
  assert.equal(bounded.telemetry.tokenEstimatorId, 'whitespace-v1');
  assert.equal(TEAM_PROVIDER_IDS.includes('gemini-direct'), true);
  assert.equal(TEAM_DIRECT_API_PROVIDER_IDS.includes('gemini-direct'), true);

  const bridge = createGeminiDirectTeamProviderBridge({ schemaId: 'atm.geminiDirectTeamProviderConfig.v1', providerId: 'gemini-direct', sdkId: 'gemini-generate-content', modelId: 'gemini-test', apiKeyEnvVar: 'GEMINI_API_KEY' });
  const bridgeRun = await launchGeminiDirectTeamProviderRun({ bridge, request: { taskId: 'TASK-TEAM-0071', role: 'validator', providerId: 'gemini-direct', sdkId: 'gemini-generate-content', modelId: 'gemini-test', runtimeMode: 'real-agent' }, permissionPolicy: createDefaultTeamPermissionPolicy(), scopedPaths: ['packages/cli/src/commands/team.ts'], env: { GEMINI_API_KEY: 'fixture' }, executor });
  assert.equal(bridgeRun.ok, true);
  assert.equal(bridgeRun.artifact.redaction.rawSecretsLogged, false);
  console.log(`[validate-team-agents] ok (${taskCase})`);
  return true;
}
