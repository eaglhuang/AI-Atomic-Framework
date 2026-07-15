import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { inspectTeamRuntimeBackendCapabilities } from '../../../packages/cli/src/commands/integration.ts';
import { buildTeamRuntimeContract, runTeam } from '../../../packages/cli/src/commands/team.ts';
import { TEAM_DIRECT_API_PROVIDER_IDS } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { createTempWorkspace, initializeGitRepository } from '../../temp-root.ts';

export async function runDirectProviderExecuteAdmissionValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'direct-provider-execute-admission') return false;

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
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture: initialize direct provider admission'], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ATM Validator',
      GIT_AUTHOR_EMAIL: 'validator@example.invalid',
      GIT_COMMITTER_NAME: 'ATM Validator',
      GIT_COMMITTER_EMAIL: 'validator@example.invalid'
    },
    stdio: 'ignore'
  });

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
  return true;
}
