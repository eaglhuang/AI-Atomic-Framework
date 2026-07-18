import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assert,
  initializeGit,
  makeAdopterRepo,
  runIntegrationHookInvocationInProcess,
  runNext,
  runTasks,
  writeEvidence,
  writeJson,
  writeLedgerTask
} from './context.ts';

export async function validateNextClaimPromptScopeConsistency(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-next-claim-prompt-scope');
  writeFileSync(path.join(repo, 'src', 'three.ts'), 'export const three = 3;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-ADOPT-0003', 'Adopter task three with multi-deliverables', 'src/one.ts', {
    scopePaths: ['src/one.ts', 'src/two.ts', 'src/three.ts']
  });
  writeEvidence(repo, 'TASK-ADOPT-0003');
  initializeGit(repo);

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0003']);
  assert(claim.ok === true, 'next claim prompt sync: next --claim must succeed');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0003.json');
  assert(existsSync(taskPath), 'next claim prompt sync: task ledger JSON must exist');
  const taskData = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;

  const claimFiles = taskData.claim?.files ?? [];
  const allowedFiles = taskData.taskDirectionLock?.allowedFiles ?? [];

  assert(claimFiles.includes('src/one.ts'), 'claim.files must contain src/one.ts');
  assert(claimFiles.includes('src/two.ts'), 'claim.files must contain src/two.ts');
  assert(claimFiles.includes('src/three.ts'), 'claim.files must contain src/three.ts');

  assert(allowedFiles.includes('src/one.ts'), 'allowedFiles must contain src/one.ts');
  assert(allowedFiles.includes('src/two.ts'), 'allowedFiles must contain src/two.ts');
  assert(allowedFiles.includes('src/three.ts'), 'allowedFiles must contain src/three.ts');

  const hookResult = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', 'TASK-ADOPT-0003',
    '--files', 'src/one.ts,src/two.ts,src/three.ts'
  ]);
  assert(hookResult.ok === true, `pre-tool hook must allow edits to all three deliverables. Messages: ${JSON.stringify(hookResult.messages)}`);
}

export async function validateOutOfScopeSubtraction(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-out-of-scope-subtraction');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0004.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-ADOPT-0004',
    title: 'outOfScope subtraction test',
    status: 'ready',
    dependencies: [],
    scopePaths: ['src/one.ts', 'src/two.ts', 'src/three.ts'],
    outOfScope: ['src/two.ts'],
    source: {
      planPath: 'docs/plan.md',
      sectionTitle: 'outOfScope subtraction test',
      headingLine: 1,
      hash: 'TASK-ADOPT-0004'
    }
  });
  writeEvidence(repo, 'TASK-ADOPT-0004');
  initializeGit(repo);

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0004']);
  assert(claim.ok === true, 'outOfScope subtraction: next --claim must succeed');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0004.json');
  assert(existsSync(taskPath), 'outOfScope subtraction: task ledger JSON must exist');
  const taskData = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;

  const claimFiles = taskData.claim?.files ?? [];
  const allowedFiles = taskData.taskDirectionLock?.allowedFiles ?? [];

  assert(allowedFiles.includes('src/one.ts'), 'allowedFiles must contain src/one.ts');
  assert(!allowedFiles.includes('src/two.ts'), 'allowedFiles must NOT contain src/two.ts (subtracted)');
  assert(allowedFiles.includes('src/three.ts'), 'allowedFiles must contain src/three.ts');

  const undefinedRepo = makeAdopterRepo(tempRoot, 'adopter-out-of-scope-undefined');
  writeJson(path.join(undefinedRepo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0005.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-ADOPT-0005',
    title: 'outOfScope undefined test',
    status: 'ready',
    dependencies: [],
    scopePaths: ['src/one.ts', 'src/two.ts'],
    source: {
      planPath: 'docs/plan.md',
      sectionTitle: 'outOfScope undefined test',
      headingLine: 1,
      hash: 'TASK-ADOPT-0005'
    }
  });
  writeEvidence(undefinedRepo, 'TASK-ADOPT-0005');
  initializeGit(undefinedRepo);
  const claim2 = await runNext(['--cwd', undefinedRepo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0005']);
  assert(claim2.ok === true, 'outOfScope undefined: next --claim must succeed');
  const taskPath2 = path.join(undefinedRepo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0005.json');
  const taskData2 = JSON.parse(readFileSync(taskPath2, 'utf8')) as Record<string, any>;
  const allowedFiles2 = taskData2.taskDirectionLock?.allowedFiles ?? [];
  assert(allowedFiles2.includes('src/one.ts'), 'allowedFiles2 must contain src/one.ts. Got ledger=' + JSON.stringify(taskData2) + ' claim=' + JSON.stringify(claim2.evidence));
  assert(allowedFiles2.includes('src/two.ts'), 'allowedFiles2 must contain src/two.ts');

  const markdownText = `---
task_id: TASK-ADOPT-0006
title: markdown outOfScope test
status: ready
scopePaths:
  - src/one.ts
  - src/two.ts
forbidden_files:
  - src/two.ts
---
forbidden paths in prose like src/two.ts
`;
  const markdownRepo = makeAdopterRepo(tempRoot, 'adopter-out-of-scope-markdown');
  initializeGit(markdownRepo);
  mkdirSync(path.join(markdownRepo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks'), { recursive: true });
  writeFileSync(path.join(markdownRepo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks', 'TASK-ADOPT-0006.task.md'), markdownText, 'utf8');

  const imp = await runTasks(['import', '--cwd', markdownRepo, '--from', 'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-ADOPT-0006.task.md', '--write', '--json']);
  assert(imp.ok === true, 'markdown outOfScope import: must succeed');

  const claim3 = await runNext(['--cwd', markdownRepo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0006']);
  assert(claim3.ok === true, 'markdown outOfScope: next --claim must succeed');
  const taskPath3 = path.join(markdownRepo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0006.json');
  const taskData3 = JSON.parse(readFileSync(taskPath3, 'utf8')) as Record<string, any>;
  const allowedFiles3 = taskData3.taskDirectionLock?.allowedFiles ?? [];

  assert(allowedFiles3.includes('src/one.ts'), 'allowedFiles3 must contain src/one.ts');
  assert(!allowedFiles3.includes('src/two.ts'), 'allowedFiles3 must NOT contain src/two.ts');
}



