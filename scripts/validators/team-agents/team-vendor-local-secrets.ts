import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadTeamVendorLocalSecrets } from '../../../packages/cli/src/commands/team.ts';
import { createTeamProviderMetadata } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { runProviderOrchestration } from '../../../packages/core/src/team-runtime/execution-orchestrator.ts';
import { createTempWorkspace } from '../../temp-root.ts';

export async function runTeamVendorLocalSecretsValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-vendor-local-secrets') return false;

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
  return true;
}
