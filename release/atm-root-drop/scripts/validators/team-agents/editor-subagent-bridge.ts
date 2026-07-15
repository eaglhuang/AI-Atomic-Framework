import assert from 'node:assert/strict';

import { buildTeamRuntimeContract } from '../../../packages/cli/src/commands/team.ts';

export async function runEditorSubagentBridgeValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'editor-subagent-bridge') return false;

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
  return true;
}
