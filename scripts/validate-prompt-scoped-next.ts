import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runNext } from '../packages/cli/src/commands/next.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'prompt-scoped-next-'));
  try {
    const planDir = path.join(tempRoot, 'docs', 'plan');
    const taskDir = path.join(planDir, 'tasks');
    const otherTaskDir = path.join(tempRoot, 'docs', 'other', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(otherTaskDir, { recursive: true });

    writeFileSync(path.join(planDir, 'PlanAlpha.md'), '# Plan Alpha\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'docs', 'other', 'OtherPlan.md'), '# Other Plan\n', 'utf8');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0001.task.md'), 'TASK-ALPHA-0001', 'Alpha first task');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0002.task.md'), 'TASK-ALPHA-0002', 'Alpha second task');
    writeTaskCard(path.join(otherTaskDir, 'TASK-OTHER-0001.task.md'), 'TASK-OTHER-0001', 'Other task');

    const exact = await runNext(['--cwd', tempRoot, '--prompt', '請實作 TASK-ALPHA-0001']);
    assert(exact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to one task');
    assert((exact.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'exact task id prompt selected wrong task');

    const markdownClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', '請實作 TASK-ALPHA-0001']);
    assert(markdownClaim.ok === false, 'next --claim must not pretend to claim a Markdown-only task card');
    assert(markdownClaim.messages.some((entry) => entry.code === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'), 'next --claim must require import for Markdown task cards');

    const intentPath = path.join(tempRoot, '.atm', 'runtime', 'task-intent.json');
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(intentPath, `${JSON.stringify({
      schemaId: 'atm.taskIntent.v1',
      userPrompt: 'skill resolved alpha two',
      mentionedTaskIds: ['TASK-ALPHA-0002'],
      mentionedPlanPaths: [],
      taskRootHints: [],
      targetRepoHints: [],
      requestedAction: 'implement',
      confidence: 0.95,
      source: 'atm-skill'
    }, null, 2)}\n`, 'utf8');
    const intent = await runNext(['--cwd', tempRoot, '--intent', intentPath]);
    assert(intent.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'intent file must route to one task');
    assert((intent.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0002', 'intent file selected wrong task');

    const queue = await runNext(['--cwd', tempRoot, '--prompt', 'PlanAlpha 前兩張任務卡']);
    assert(queue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'plan-scoped ordinal prompt must return a task queue');
    assert((queue.evidence.nextAction as any).queueSize === 2, 'plan-scoped ordinal prompt must select two tasks');

    const ambiguous = await runNext(['--cwd', tempRoot, '--prompt', '請幫我做下一張任務卡']);
    assert(ambiguous.ok === false, 'ambiguous task-card prompt must not route as ok');
    assert(ambiguous.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SELECTION_REQUIRED'), 'ambiguous task-card prompt must ask for task selection');

    const nonTaskPrompt = await runNext(['--cwd', tempRoot, '--prompt', '請幫我整理 onboarding 說明']);
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'non-task prompt must route to prompt-scoped guidance');

    const noPrompt = await runNext(['--cwd', tempRoot]);
    const importedTaskQueue = noPrompt.evidence.importedTaskQueue as { selectedTask?: unknown };
    assert(importedTaskQueue.selectedTask == null, 'next without prompt must not auto-pick a global open/planned task');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeTaskCard(filePath: string, taskId: string, title: string) {
  writeFileSync(filePath, `---
task_id: ${taskId}
title: ${title}
status: planned
target_repo: AI-Atomic-Framework
closure_authority: target_repo
---
# ${taskId}
`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
