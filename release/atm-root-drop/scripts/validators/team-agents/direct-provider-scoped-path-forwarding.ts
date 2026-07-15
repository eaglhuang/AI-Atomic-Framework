import assert from 'node:assert/strict';
import { runDirectTeamProviderRole } from '../../../packages/cli/src/commands/team.ts';

export async function runDirectProviderScopedPathForwardingValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'direct-provider-scoped-path-forwarding') return false;

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
  return true;
}
