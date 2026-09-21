import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, initializeGitRepository } from '../../packages/cli/src/temp-workspace.ts';
import { enrichCommandResult } from '../../packages/cli/src/commands/shared.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';

async function testStateOnlyTeamStartSucceedsWithoutExecutionBackend() {
  const cwd = createTempWorkspace('atm-team-state-only-admission-');
  initializeGitRepository(cwd);
  const taskId = 'TASK-TEAM-STATE-ONLY-ADMISSION';
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'State-only admission fixture',
    status: 'running',
    targetRepo: 'AI-Atomic-Framework',
    scopePaths: ['docs/state-only-admission.md'],
    deliverables: ['docs/state-only-admission.md'],
    validators: ['validator']
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(cwd, 'docs', 'state-only-admission.md'), '# Fixture\n', 'utf8');

  // Request a non-broker runtime mode (e.g. editor-subagent or real-agent) without --execute
  const stateOnly = await runTeam([
    'start',
    '--task', taskId,
    '--actor', 'validator',
    '--cwd', cwd,
    '--runtime-mode', 'editor-subagent',
    '--provider', 'non-existent-provider',
    '--json'
  ]);

  // ACC-1: State-only start must succeed, mint no worker execution, and record executeRequested: false
  assert.equal(stateOnly.ok, true, 'state-only start must succeed even if provider/execution backend is not declared in integration manifests');
  assert.ok(stateOnly.messages.some((entry) => entry.code === 'ATM_TEAM_STARTED'), 'must emit ATM_TEAM_STARTED');
  assert.equal((stateOnly.evidence as { executeRequested?: boolean })?.executeRequested, false);
  assert.equal((stateOnly.evidence as { agentsSpawned?: boolean })?.agentsSpawned, false);
  assert.equal((stateOnly.evidence as { runtimeWritten?: boolean })?.runtimeWritten, true);

  const enriched = enrichCommandResult(stateOnly);
  assert.equal(enriched.exitCode, 0);
  assert.equal(enriched.blocking, false);
}

async function testTeamStartExecuteWithMissingBackendFailsClosed() {
  const cwd = createTempWorkspace('atm-team-execute-missing-backend-');
  initializeGitRepository(cwd);
  const taskId = 'TASK-TEAM-EXECUTE-MISSING-BACKEND';
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Execute missing backend fixture',
    status: 'running',
    targetRepo: 'AI-Atomic-Framework',
    scopePaths: ['docs/execute-missing-backend.md'],
    deliverables: ['docs/execute-missing-backend.md'],
    validators: ['validator']
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(cwd, 'docs', 'execute-missing-backend.md'), '# Fixture\n', 'utf8');

  // Request execution with --execute and a missing provider backend
  const executeRun = await runTeam([
    'start',
    '--task', taskId,
    '--actor', 'validator',
    '--cwd', cwd,
    '--runtime-mode', 'editor-subagent',
    '--provider', 'non-existent-provider',
    '--execute',
    '--json'
  ]);

  // ACC-2: team start --execute with missing backend remains fail-closed as ATM_TEAM_RUNTIME_BACKEND_MISSING
  assert.equal(executeRun.ok, false, 'team start --execute must fail closed when backend is missing');
  const missingBackendMsg = executeRun.messages.find((entry) => entry.code === 'ATM_TEAM_RUNTIME_BACKEND_MISSING');
  assert.ok(missingBackendMsg, 'must emit ATM_TEAM_RUNTIME_BACKEND_MISSING when --execute is passed');
  assert.equal(missingBackendMsg?.level, 'error');
  assert.equal((executeRun.evidence as { agentsSpawned?: boolean })?.agentsSpawned, false);
  assert.equal((executeRun.evidence as { runtimeWritten?: boolean })?.runtimeWritten, false);

  // Check structured recovery
  const recovery = (executeRun.evidence as { backendAdmissionRecovery?: any })?.backendAdmissionRecovery;
  assert.ok(recovery, 'structured recovery must be present');
  assert.equal(recovery.schemaId, 'atm.teamRuntimeBackendRecovery.v1');
  assert.equal(recovery.requested.providerId, 'non-existent-provider');
  assert.equal(recovery.requested.runtimeMode, 'editor-subagent');
  assert.ok(Array.isArray(recovery.supportedCapabilities));

  const enriched = enrichCommandResult(executeRun);
  assert.equal(enriched.exitCode, 1);
  assert.equal(enriched.blocking, true);
}

await testStateOnlyTeamStartSucceedsWithoutExecutionBackend();
await testTeamStartExecuteWithMissingBackendFailsClosed();

console.log('tests/cli/team-state-only-runtime-admission.test: ok');
