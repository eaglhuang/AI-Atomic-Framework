import {
  assert,
  initializeGit,
  makeFrameworkRepo,
  runFrameworkTempClaim,
  runIntegrationHookInvocationInProcess,
  runNext,
  writeJson
} from './context.ts';
import path from 'node:path';

export async function validateFrameworkDevelopment(tempRoot: string) {
  const repo = makeFrameworkRepo(tempRoot, 'ai-atomic-framework');
  initializeGit(repo);
  const prompt = 'TASK-FW-0001 TASK-FW-0002 all task cards';

  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'framework prompt must resolve to a scoped task queue');

  const beforeClaim = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(beforeClaim.ok === false, 'framework critical edit must be blocked before task/framework claim');
  assert(beforeClaim.messages.some((entry) => entry.code === 'ATM_TASK_DIRECTION_LOCK_REQUIRED' || entry.code === 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED'), 'framework pre-tool must report missing claim');

  writeJson(path.join(repo, '.atm', 'runtime', 'task-direction-locks', 'TASK-FW-0001.json'), {
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId: 'TASK-FW-0001',
    queueId: null,
    queueIndex: null,
    allowedFiles: ['packages/core/src/one.ts'],
    promptHash: null,
    actorId: 'framework-agent',
    createdAt: new Date().toISOString(),
    status: 'active'
  });
  const directionOnlyBlock = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(directionOnlyBlock.ok === false, 'framework direction lock alone must not satisfy framework-development hard gate');
  assert(directionOnlyBlock.messages.some((entry) => entry.code === 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED'), 'framework direction-only block must require framework claim');

  const taskClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'framework-agent', '--prompt', prompt]);
  assert(taskClaim.ok === true, 'framework next --claim must claim queue head and write direction lock');

  const withFrameworkTaskClaim = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkTaskClaim.ok === true, 'framework task claim plus direction lock must allow critical in-scope edit');

  await runFrameworkTempClaim(repo, 'framework-agent', ['packages/core/src/one.ts'], 'test framework hard gate');

  const withFrameworkClaim = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkClaim.ok === true, 'framework critical in-scope edit must pass with both direction lock and framework claim');

  const frameworkScopeDrift = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/two.ts'
  ]);
  assert(frameworkScopeDrift.ok === false, 'framework mode must still enforce task direction scope after framework claim');
  assert(frameworkScopeDrift.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'framework scope drift must report the shared direction-lock blocker');
}

