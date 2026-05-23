import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFrameworkTempClaim } from '../packages/cli/src/commands/framework-development.ts';
import { runIntegrationHookInvocation } from '../packages/cli/src/commands/integration-hooks.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[task-direction-governance:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-governance-'));
  try {
    await validateAdopterGoverned(tempRoot);
    await validateFrameworkDevelopment(tempRoot);
    if (!process.exitCode) {
      console.log(`[task-direction-governance:${mode}] ok (adopter-governed and framework-development task direction gates verified)`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function validateAdopterGoverned(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-governed');
  const prompt = 'TASK-ADOPT-0001 TASK-ADOPT-0002 all task cards';

  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'adopter prompt must resolve to a scoped task queue');
  assert((route.evidence.taskQueue as any)?.schemaId === 'atm.taskQueue.v1', 'adopter queue must persist atm.taskQueue.v1');
  assert((route.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0001', 'adopter queue head must be first task');

  const beforeClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(beforeClaim.ok === false, 'adopter prompt-scoped edit must be blocked before claim');
  assert(beforeClaim.messages.some((entry) => entry.code === 'ATM_TASK_DIRECTION_LOCK_REQUIRED'), 'adopter pre-tool block must require a direction lock');

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'adopter next --claim must claim queue head');
  assert((claim.evidence.taskDirectionLock as any)?.taskId === 'TASK-ADOPT-0001', 'adopter claim must create direction lock for queue head');

  const inScope = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(inScope.ok === true, 'adopter in-scope edit must pass after direction lock');

  const outOfScope = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/two.ts'
  ]);
  assert(outOfScope.ok === false, 'adopter queue must block edits to the next task before queue head closes');
  assert(outOfScope.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'adopter out-of-scope edit must report scope drift');

  try {
    await runTasks(['close', '--cwd', repo, '--task', 'TASK-ADOPT-0002', '--actor', 'adopter-agent', '--status', 'done']);
    fail('adopter queue must not allow closing the second task before queue head');
  } catch (error) {
    assert((error as any).code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED' || (error as any).code === 'ATM_TASK_QUEUE_HEAD_REQUIRED', 'adopter queue must reject premature close');
  }

  await runTasks(['close', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--status', 'done']);
  const afterFirstClose = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert((afterFirstClose.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0002', 'adopter queue must advance to second task after closing first');
}

async function validateFrameworkDevelopment(tempRoot: string) {
  const repo = makeFrameworkRepo(tempRoot, 'ai-atomic-framework');
  const prompt = 'TASK-FW-0001 TASK-FW-0002 all task cards';

  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'framework prompt must resolve to a scoped task queue');

  const beforeClaim = runIntegrationHookInvocation([
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
  const directionOnlyBlock = runIntegrationHookInvocation([
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

  const withFrameworkTaskClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkTaskClaim.ok === true, 'framework task claim plus direction lock must allow critical in-scope edit');

  await runFrameworkTempClaim(repo, 'framework-agent', ['packages/core/src/one.ts'], 'test framework hard gate');

  const withFrameworkClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkClaim.ok === true, 'framework critical in-scope edit must pass with both direction lock and framework claim');

  const frameworkScopeDrift = runIntegrationHookInvocation([
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

function makeAdopterRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name, type: 'module' });
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-ADOPT-0001', 'Adopter task one', 'src/one.ts');
  writeLedgerTask(repo, 'TASK-ADOPT-0002', 'Adopter task two', 'src/two.ts');
  writeEvidence(repo, 'TASK-ADOPT-0001');
  writeEvidence(repo, 'TASK-ADOPT-0002');
  return repo;
}

function makeFrameworkRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name: 'ai-atomic-framework', workspaces: ['packages/*'] });
  writeJson(path.join(repo, 'atomic-registry.json'), { entries: [] });
  writeJson(path.join(repo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs',
    sourcePath: 'release/atm-onefile/atm.mjs'
  });
  mkdirSync(path.join(repo, 'release', 'atm-onefile'), { recursive: true });
  writeFileSync(path.join(repo, 'release', 'atm-onefile', 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const core = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const atm = true;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-FW-0001', 'Framework task one', 'packages/core/src/one.ts');
  writeLedgerTask(repo, 'TASK-FW-0002', 'Framework task two', 'packages/core/src/two.ts');
  writeEvidence(repo, 'TASK-FW-0001');
  writeEvidence(repo, 'TASK-FW-0002');
  return repo;
}

function writeLedgerTask(repo: string, taskId: string, title: string, scopePath: string) {
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: 'ready',
    dependencies: [],
    scope: [scopePath],
    source: {
      planPath: 'docs/plan.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  });
}

function writeEvidence(repo: string, taskId: string) {
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`), {
    taskId,
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'validator fixture evidence',
        details: { command: 'fixture-pass', exitCode: 0 }
      }
    ]
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
