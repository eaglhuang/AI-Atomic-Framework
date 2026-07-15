import assert from 'node:assert/strict';
import { buildTeamRuntimeContract } from '../../../packages/cli/src/commands/team.ts';
import { resolveTeamProviderSelection } from '../../../packages/core/src/team-runtime/provider-selection.ts';

export function runProviderSelectionOverridesValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'provider-selection-overrides') return false;

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
  return true;
}
