import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runBatch } from '../packages/cli/src/commands/batch.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../packages/cli/src/commands/quickfix.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';
import { runTeam } from '../packages/cli/src/commands/team.ts';
import { listActiveBatchRuns } from '../packages/cli/src/commands/work-channels.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDecisionTrail(action: any, expectedStatus: string) {
  const trail = action?.decisionTrail;
  assert(Array.isArray(trail) && trail.length > 0, `${expectedStatus} route must expose nextAction.decisionTrail`);
  assert(trail[0]?.check === 'route-status', `${expectedStatus} decisionTrail must start with route-status`);
  assert(trail[0]?.reason && typeof trail[0].reason === 'string', `${expectedStatus} decisionTrail route-status needs a public reason`);
  assert(!JSON.stringify(trail).toLowerCase().includes('chain-of-thought'), `${expectedStatus} decisionTrail must not expose private reasoning labels`);
  return trail as Array<{
    check: string;
    result: string;
    reason: string;
    evidencePath?: string;
    nextCommand?: string;
  }>;
}

function assertRunnerMode(result: any) {
  const runnerMode = result?.evidence?.nextAction?.runnerMode;
  assert(runnerMode?.schemaId === 'atm.runnerMode.v1', 'nextAction must expose atm.runnerMode.v1');
  assert(result?.evidence?.runnerMode?.schemaId === 'atm.runnerMode.v1', 'next evidence must expose runnerMode');
  assert(runnerMode.normalGovernanceCommand === 'node atm.mjs ...', 'runner mode must point normal governance to node atm.mjs');
  assert(runnerMode.sourceFirstCommand === 'node atm.dev.mjs ...', 'runner mode must point source validation to node atm.dev.mjs');
  assert(runnerMode.syncCommand === 'npm run build', 'runner mode must preserve npm run build as the frozen sync command');
  assert(['frozen', 'source-first', 'source-import'].includes(runnerMode.mode), 'runner mode must classify known ATM entrypoints');
  assert(String(runnerMode.sourceFirstOnlyWhen).includes('explicit source-first framework validation'), 'runner mode must restrict source-first guidance to explicit validation');
}

function assertTeamRecommendation(action: any, expectedChannel: string, expectedTaskId?: string) {
  const recommendation = action?.teamRecommendation;
  assert(recommendation?.schemaId === 'atm.teamRecommendation.v1', 'nextAction must expose atm.teamRecommendation.v1');
  assert(recommendation?.required === false, 'teamRecommendation must stay advisory');
  assert(typeof recommendation?.reason === 'string' && recommendation.reason.length > 0, 'teamRecommendation must include reason');
  assert(String(recommendation?.plan).includes('team plan'), 'teamRecommendation.plan must suggest team plan');
  assert(String(recommendation?.start).includes('team start'), 'teamRecommendation.start must suggest team start');
  assert(String(recommendation?.status).includes('team status'), 'teamRecommendation.status must suggest team status');
  assert(recommendation?.channel === expectedChannel, `teamRecommendation channel must be ${expectedChannel}`);
  if (expectedTaskId) {
    assert(recommendation?.taskId === expectedTaskId, `teamRecommendation taskId must be ${expectedTaskId}`);
  }
  assert(action?.playbook?.teamRecommendation?.schemaId === 'atm.teamRecommendation.v1', 'playbook must embed teamRecommendation');
}

async function main() {
  const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'prompt-scoped-next-'));
  const previousGitCeilingDirectories = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = [process.cwd(), previousGitCeilingDirectories]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(path.delimiter);
  try {
    const planDir = path.join(tempRoot, 'docs', 'plan');
    const taskDir = path.join(planDir, 'tasks');
    const otherTaskDir = path.join(tempRoot, 'docs', 'other', 'tasks');
    const ignoredTmpTaskDir = path.join(tempRoot, 'local', 'tmp', 'sanguo-rag-smoke', 'tasks');
    const externalPlanDir = path.join(path.dirname(tempRoot), '3KLife', 'docs', 'ai_atomic_framework', 'atm-agent-first-operability');
    const externalTaskDir = path.join(externalPlanDir, 'tasks');
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(otherTaskDir, { recursive: true });
    mkdirSync(ignoredTmpTaskDir, { recursive: true });
    mkdirSync(externalTaskDir, { recursive: true });

    writeFileSync(path.join(planDir, 'PlanAlpha.md'), '# Plan Alpha\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'docs', 'other', 'OtherPlan.md'), '# Other Plan\n', 'utf8');
    writeFileSync(path.join(externalPlanDir, 'ATM Agent-First 可操作性優化計畫書.md'), '# ATM Agent-First 可操作性優化計畫書\n\n| 任務 | 狀態 |\n|---|---|\n| TASK-AAO-0001 | open |\n| TASK-AAO-0002 | open |\n', 'utf8');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0001.task.md'), 'TASK-ALPHA-0001', 'Alpha first task');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0002.task.md'), 'TASK-ALPHA-0002', 'Alpha second task');
    writeTaskCard(path.join(otherTaskDir, 'TASK-OTHER-0001.task.md'), 'TASK-OTHER-0001', 'Other task');
    writeTaskCard(path.join(otherTaskDir, 'SANGUO-BOOTSTRAP-0001.task.md'), 'SANGUO-BOOTSTRAP-0001', 'Sanguo bootstrap task');
    writeTaskCard(path.join(ignoredTmpTaskDir, 'TASK-TMP-0001.task.md'), 'TASK-TMP-0001', 'Temporary task that discovery must ignore');
    writeTaskCard(path.join(tempRoot, 'TASK-APO-0030-python-language-adapter-plugin.task.md'), 'TASK-APO-0030-python-language-adapter-plugin', 'Unrelated root task');
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0000-doc-finalize-bridge-index.task.md'), 'TASK-AAO-0000', 'AAO docs baseline', { status: 'done' });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0001-report-overlap-matrix-routing.task.md'), 'TASK-AAO-0001', 'AAO overlap routing', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md',
      files: 'packages/cli/src/commands/next.ts, docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0001-report-overlap-matrix-routing.task.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0002-cli-spec-runner-ssot-drift-guard.task.md'), 'TASK-AAO-0002', 'AAO CLI spec drift guard', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0011-untracked-file-scope-warnings.task.md'), 'TASK-AAO-0011', 'AAO untracked file scope warnings', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0030-crlf-policy.task.md'), 'TASK-AAO-0030', 'AAO CRLF policy', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0046-validator-baseline-noise-diagnostics.task.md'), 'TASK-AAO-0046', 'AAO validator noise diagnostics', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });

    const exact = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-ALPHA-0001']);
    assert(exact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to one task');
    assert((exact.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'exact task id prompt selected wrong task');
    assert((exact.evidence.nextAction as any).recommendedChannel === 'normal', 'exact task id prompt must recommend normal channel');
    const exactTrail = assertDecisionTrail(exact.evidence.nextAction as any, 'task-route-ready');
    assert(exactTrail.some((entry) => entry.check === 'task-selection' && entry.result === 'pass'), 'exact task route decisionTrail must record task selection');
    assertTeamRecommendation(exact.evidence.nextAction as any, 'normal', 'TASK-ALPHA-0001');
    assert(exact.messages.some((entry) => entry.code === 'ATM_TEAM_RECOMMENDATION'), 'task route must emit team recommendation advisory');

    const explicitTask = await runNext(['--cwd', tempRoot, '--task', 'TASK-ALPHA-0001']);
    assert(explicitTask.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'next --task must route to one task');
    assert((explicitTask.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'next --task selected wrong task');
    assert((explicitTask.evidence.nextAction as any).recommendedChannel === 'normal', 'next --task must recommend normal channel');
    assert(String((explicitTask.evidence.nextAction as any).requiredCommand).includes('--task TASK-ALPHA-0001'), 'next --task must keep the claim command on --task');
    assertRunnerMode(explicitTask);

    const genericExact = await runNext(['--cwd', tempRoot, '--prompt', '請處理 SANGUO-BOOTSTRAP-0001']);
    assert(genericExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'generic governed task id prompt must route to one task');
    assert((genericExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'generic governed task id prompt selected wrong task');

    const ignoredTmpExact = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-TMP-0001']);
    assert(!ignoredTmpExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'task discovery must ignore task cards under local/tmp');

    const quickfixPrompt = '請小修 tsconfig.json typo';
    const quickfixRoute = await runNext(['--cwd', tempRoot, '--prompt', quickfixPrompt]);
    assert(quickfixRoute.messages.some((entry) => entry.code === 'ATM_NEXT_QUICKFIX_ROUTE_READY'), 'quickfix prompt must route to the fast channel');
    assert((quickfixRoute.evidence.nextAction as any).recommendedChannel === 'fast', 'quickfix route must recommend fast channel');
    const quickfixClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', quickfixPrompt]);
    assert(quickfixClaim.ok === true, 'quickfix next --claim must succeed');
    assert((quickfixClaim.evidence.quickfixLock as any)?.schemaId === 'atm.quickfixLock.v1', 'quickfix next --claim must persist atm.quickfixLock.v1');
    const quickfixStatus = await runQuickfix(['status', '--cwd', tempRoot, '--json']);
    assert((quickfixStatus.evidence.lock as any)?.actorId === 'prompt-scope-test', 'quickfix status must report the active lock');
    const quickfixRelease = await runQuickfix(['release', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((quickfixRelease.evidence.lock as any)?.status === 'released', 'quickfix release must mark the lock as released');

    const markdownClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'Please implement TASK-ALPHA-0001']);
    assert(markdownClaim.ok === false, 'next --claim must not pretend to claim a Markdown-only task card');
    assert(markdownClaim.messages.some((entry) => entry.code === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'), 'next --claim must require import for Markdown task cards');

    const intentPath = path.join(tempRoot, '.atm', 'runtime', 'task-intent.json');
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(path.join(tempRoot, 'docs', 'plan', 'TASK-ALPHA-0002.note.md'), '# helper\n', 'utf8');
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

    const queue = await runNext(['--cwd', tempRoot, '--prompt', 'PlanAlpha first 2 task cards']);
    assert(queue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'plan-scoped ordinal prompt must return a task queue');
    assert(queue.messages.some((entry) => entry.code === 'ATM_TASK_DELIVERY_PRINCIPLE'), 'plan-scoped queue route must remind agents that delivery comes before closure');
    assert((queue.evidence.nextAction as any).queueSize === 2, 'plan-scoped ordinal prompt must select two tasks');
    assert((queue.evidence.nextAction as any).recommendedChannel === 'batch', 'plan-scoped queue prompt must recommend batch channel');
    assert((queue.evidence.nextAction as any).deliveryPrinciple?.schemaId === 'atm.taskDeliveryPrinciple.v1', 'plan-scoped queue prompt must carry delivery principle evidence');
    assert((queue.evidence.taskQueue as any)?.schemaId === 'atm.taskQueuePreview.v1', 'plan-scoped queue prompt must stay read-only and only expose a queue preview');
    assert((queue.evidence.nextAction as any).queueHeadTaskId === 'TASK-ALPHA-0001', 'plan-scoped queue must expose the queue head');
    const queueTrail = assertDecisionTrail(queue.evidence.nextAction as any, 'task-queue-ready');
    assertTeamRecommendation(queue.evidence.nextAction as any, 'batch', 'TASK-ALPHA-0001');
    assert(queueTrail.some((entry) => entry.check === 'queue-head' && entry.reason.includes('TASK-ALPHA-0001')), 'queue decisionTrail must record the queue head');

    const scopedNotFound = await runNext(['--cwd', tempRoot, '--prompt', 'ATM framework 100% self atomization plan implement all task cards']);
    assert(scopedNotFound.ok === false, 'explicit scoped prompt without matching tasks must not route to an unrelated task');
    assert(scopedNotFound.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'explicit scoped prompt without matching tasks must report task scope not found');
    const scopedNotFoundTrail = assertDecisionTrail(scopedNotFound.evidence.nextAction as any, 'task-scope-not-found');
    assert(scopedNotFoundTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'blocked'), 'scope-not-found decisionTrail must record fail-closed scope resolution');

    const collaborationIsolationPrompt = '修正 git hook 的平行協作隔離：docs-only 或不含 ATM task/evidence 的一般 commit/push 不應被其他本機 ahead governance commits 或 active ATM task 狀態阻擋';
    const collaborationIsolation = await runNext(['--cwd', tempRoot, '--prompt', collaborationIsolationPrompt]);
    assert(!collaborationIsolation.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'natural language commit/push isolation prompt must not be misread as a task scope because of task/evidence or commit/push text');
    assert((collaborationIsolation.evidence.taskIntent as any)?.taskScopeMentioned === false, 'commit/push isolation prompt must not set taskScopeMentioned without a real task id, task card, plan, or path');

    const analyzePlanPrompt = '請分析目前最適合優先執行的開發計畫是哪一塊? 目前 ATM 還沒有很優化 跟 bug 的部分是哪一個呢 ?';
    const analyzePlanRoute = await runNext(['--cwd', tempRoot, '--prompt', analyzePlanPrompt]);
    assert((analyzePlanRoute.evidence.taskIntent as any)?.requestedAction === 'analyze', 'analysis prompts that mention 開發計畫 must keep requestedAction=analyze instead of implement');
    assert(!analyzePlanRoute.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'analysis-only planning prompts must not be routed as an implementation task');

    const externalPlanQueue = await runNext(['--cwd', tempRoot, '--prompt', '閱讀 ATM Agent-First 可操作性優化計畫書，請按照 ATM 的流程完成所有任務卡']);
    assert(externalPlanQueue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'external planning document prompt must route to its adjacent task cards');
    assert((externalPlanQueue.evidence.nextAction as any).recommendedChannel === 'batch', 'external planning document queue must recommend batch channel');
    assert((externalPlanQueue.evidence.nextAction as any).queueHeadTaskId === 'TASK-AAO-0001', 'external planning document queue must start at first open AAO task');
    assert(!((externalPlanQueue.evidence.nextAction as any).selectedTasks ?? []).some((task: any) => task.workItemId === 'TASK-APO-0030-python-language-adapter-plugin'), 'external planning document prompt must not fall back to unrelated low-score root task cards');
    const externalQueueHead = ((externalPlanQueue.evidence.nextAction as any).selectedTasks ?? [])[0];
    assert(((externalQueueHead?.planningReadOnlyPaths ?? []) as string[]).length > 0, 'external planning route must expose planningContext.readOnlyPaths');
    assert((externalQueueHead?.targetAllowedFiles ?? []).includes('packages/cli/src/commands/next.ts'), 'external planning route must expose targetWork.allowedFiles');
    assert(!(externalQueueHead?.targetAllowedFiles ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/')), 'targetWork.allowedFiles must exclude planning mirror paths');

    const familyQueue = await runNext(['--cwd', tempRoot, '--prompt', 'Please continue remaining AAO task cards one by one']);
    assert(familyQueue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'task family prompt must route to the matching task root queue');
    assert((familyQueue.evidence.nextAction as any).queueHeadTaskId === 'TASK-AAO-0001', 'task family queue must start at the first open matching family task');
    assert(!((familyQueue.evidence.nextAction as any).selectedTasks ?? []).some((task: any) => task.workItemId.includes('APO')), 'task family prompt must not fall back to unrelated root task cards');
    const familyTrail = assertDecisionTrail(familyQueue.evidence.nextAction as any, 'task family queue');
    assert(familyTrail.some((entry) => entry.check === 'queue-head' && entry.reason.includes('TASK-AAO-0001')), 'task family decisionTrail must record the matching queue head');

    writeTaskCard(path.join(taskDir, 'TASK-EMPTY-0001.task.md'), 'TASK-EMPTY-0001', 'Empty scope fixture', { status: 'done' });
    const emptyScope = await runNext(['--cwd', tempRoot, '--prompt', 'Please continue remaining TASK-EMPTY task cards one by one']);
    assert(emptyScope.ok === true, 'family prompt with only closed task cards must return a clean no-work result');
    assert(emptyScope.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_NO_WORK'), 'family prompt with only closed task cards must report no-work instead of scope-not-found');
    assert((emptyScope.evidence.nextAction as any).status === 'task-no-work', 'no-work route must expose task-no-work status');
    const emptyScopeTrail = assertDecisionTrail(emptyScope.evidence.nextAction as any, 'task-no-work');
    assert(emptyScopeTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'pass'), 'no-work route must record a passing prompt-scope-resolution decision');

    const shorthandExact = await runNext(['--cwd', tempRoot, '--prompt', '請補強 AAO-0011 unrelated untracked claim 行為']);
    assert(shorthandExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'AAO shorthand task id must route to canonical TASK-AAO card');
    assert((shorthandExact.evidence.nextAction as any).selectedTask.workItemId === 'TASK-AAO-0011', 'AAO shorthand exact route selected wrong canonical task');

    const shorthandMulti = await runNext(['--cwd', tempRoot, '--prompt', '補強 AAO-0030/0046 hook 診斷排序驗收條件']);
    assert(shorthandMulti.ok === false, 'multiple AAO shorthand task ids should ask for selection instead of silently choosing one');
    assert(shorthandMulti.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SELECTION_REQUIRED'), 'multiple AAO shorthand task ids must return selection required, not scope-not-found');
    const shorthandCandidates = (shorthandMulti.evidence.nextAction as any).candidates ?? [];
    assert(shorthandCandidates.some((task: any) => task.workItemId === 'TASK-AAO-0030'), 'multiple shorthand route must include TASK-AAO-0030 candidate');
    assert(shorthandCandidates.some((task: any) => task.workItemId === 'TASK-AAO-0046'), 'multiple shorthand route must include TASK-AAO-0046 candidate');

    const surfaceOnlyRejected = await runNext(['--cwd', tempRoot, '--prompt', '閱讀 不存在的治理計畫書，請完成所有任務卡']);
    assert(surfaceOnlyRejected.ok === false, 'named plan prompt with only task-card-surface candidates must fail closed');
    assert(surfaceOnlyRejected.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'named plan prompt with only task-card-surface candidates must report task scope not found');

    const ledgerTaskDir = path.join(tempRoot, '.atm', 'history', 'tasks');
    mkdirSync(ledgerTaskDir, { recursive: true });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-LEDGER-0001.json'), 'TASK-LEDGER-0001', 'Ledger first task', 'src/first.ts');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-LEDGER-0002.json'), 'TASK-LEDGER-0002', 'Ledger second task', 'src/second.ts');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DONE-0001.json'), 'TASK-DONE-0001', 'Already closed ledger task', 'src/done.ts', {
      status: 'done',
      closedAt: '2026-05-25T10:44:11.314Z',
      closedByActor: 'prompt-scope-test',
      closurePacket: '.atm/history/evidence/TASK-DONE-0001.closure-packet.json'
    });
    const doneExact = await runNext(['--cwd', tempRoot, '--prompt', 'Please check TASK-DONE-0001']);
    assert(doneExact.ok === true, 'exact already-closed task prompt must return a successful diagnostic');
    assert(doneExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ALREADY_CLOSED'), 'exact already-closed task prompt must report already-closed instead of scope-not-found');
    assert((doneExact.evidence.nextAction as any).status === 'task-already-closed', 'already-closed route must expose task-already-closed status');
    assert((doneExact.evidence.nextAction as any).closure?.closurePacketPath === '.atm/history/evidence/TASK-DONE-0001.closure-packet.json', 'already-closed route must point to the closure packet');
    assert(!String((doneExact.evidence.nextAction as any).requiredCommand ?? '').includes('next --claim'), 'already-closed route must not tell agents to claim the task');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-CROSS-0001.json'), 'TASK-CROSS-0001', 'Cross repo task', 'packages/cli/src/commands/next.ts', {
      scopePaths: [
        'packages/cli/src/commands/next.ts',
        'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-0001.task.md'
      ],
      sourcePlanPath: '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    const atomizationCoverageDir = path.join(tempRoot, 'atomic_workbench', 'atomization-coverage');
    mkdirSync(atomizationCoverageDir, { recursive: true });
    writeFileSync(path.join(atomizationCoverageDir, 'dogfood-score.json'), '{}\n', 'utf8');
    writeFileSync(path.join(taskDir, 'TASK-DOG-0003.task.md'), `---
task_id: TASK-DOG-0003
title: Dogfood score report
status: planned
target_repo: AI-Atomic-Framework
---
# TASK-DOG-0003

## Deliverables

- atm-dogfood-score.json
- atm-dogfood-score.md
`, 'utf8');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DOG-0003.json'), 'TASK-DOG-0003', 'Dogfood score report', 'scripts/src/atomize-score.js', {
      sourcePlanPath: 'docs/plan/tasks/TASK-DOG-0003.task.md',
      scopePaths: []
    });
    const dogfoodRoute = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-DOG-0003']);
    const dogfoodAllowedFiles = (dogfoodRoute.evidence.nextAction as any).selectedTask?.targetAllowedFiles ?? [];
    assert(dogfoodAllowedFiles.includes('atomic_workbench/atomization-coverage/dogfood-score.json'), 'linked task-card artifact basename must resolve dogfood-score.json into targetWork.allowedFiles');
    assert(dogfoodAllowedFiles.includes('atomic_workbench/atomization-coverage/dogfood-score.md'), 'linked task-card artifact basename must resolve dogfood-score.md into targetWork.allowedFiles even before the markdown report exists');

    writeFileSync(path.join(taskDir, 'TASK-FRONTMATTER-0001.task.md'), `---
task_id: TASK-FRONTMATTER-0001
title: Frontmatter declared scope
status: planned
target_repo: AI-Atomic-Framework
scope: [packages/cli/src/commands/evidence.ts, scripts/validate-evidence-command-runs.ts]
deliverables:
  - packages/cli/src/commands/command-specs/evidence.spec.ts
---
# TASK-FRONTMATTER-0001
`, 'utf8');
    const frontmatterRoute = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-FRONTMATTER-0001']);
    const frontmatterAllowedFiles = (frontmatterRoute.evidence.nextAction as any).selectedTask?.targetAllowedFiles ?? [];
    assert(frontmatterAllowedFiles.includes('packages/cli/src/commands/evidence.ts'), 'frontmatter scope inline array must feed targetWork.allowedFiles');
    assert(frontmatterAllowedFiles.includes('scripts/validate-evidence-command-runs.ts'), 'frontmatter scope must preserve comma-separated path entries');
    assert(frontmatterAllowedFiles.includes('packages/cli/src/commands/command-specs/evidence.spec.ts'), 'frontmatter deliverables list must feed targetWork.allowedFiles');

    writeFileSync(path.join(taskDir, 'TASK-COVERAGE-0004.task.md'), `---
task_id: TASK-COVERAGE-0004
title: Coverage guard and validate
status: planned
target_repo: AI-Atomic-Framework
---
# TASK-COVERAGE-0004

## Deliverables

- node atm.mjs guard atomization-coverage --repo . --json
- node atm.mjs validate atomization-coverage --repo . --json
- npm run validate:atomization-coverage
`, 'utf8');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-COVERAGE-0004.json'), 'TASK-COVERAGE-0004', 'Coverage guard and validate', 'atm.mjs', {
      sourcePlanPath: 'docs/plan/tasks/TASK-COVERAGE-0004.task.md',
      scopePaths: []
    });
    const coverageRoute = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-COVERAGE-0004']);
    const coverageAllowedFiles = (coverageRoute.evidence.nextAction as any).selectedTask?.targetAllowedFiles ?? [];
    assert(coverageAllowedFiles.includes('packages/cli/src/commands/guard.ts'), 'guard command task card must resolve guard.ts into targetWork.allowedFiles');
    assert(coverageAllowedFiles.includes('packages/cli/src/commands/validate.ts'), 'validate command task card must resolve validate.ts into targetWork.allowedFiles');
    assert(coverageAllowedFiles.includes('scripts/validate-atomization-coverage.ts'), 'validate topic task card must resolve topic validator script into targetWork.allowedFiles');
    assert(coverageAllowedFiles.includes('package.json'), 'npm validate script task card must resolve package.json into targetWork.allowedFiles');

    const ledgerPrompt = 'TASK-LEDGER-0001 TASK-LEDGER-0002 all task cards';
    const ledgerQueue = await runNext(['--cwd', tempRoot, '--prompt', ledgerPrompt]);
    assert(ledgerQueue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'ledger task prompt must create a queue');
    assert((ledgerQueue.evidence.nextAction as any).batchInstruction?.includes('batch checkpoint'), 'batch route must explicitly point agents to batch checkpoint');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.channel === 'batch', 'batch route must include an executable batch playbook');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.commitTiming?.includes('after batch checkpoint'), 'batch playbook must tell agents not to commit before checkpoint');
    assert(ledgerQueue.messages.some((entry) => entry.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED'), 'batch route must emit the channel playbook as a warning message');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.state === 'queue-preview', 'batch queue preview must mark the playbook as queue-preview');
    const ledgerClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', ledgerPrompt]);
    assert(ledgerClaim.ok === true, 'next --claim must claim the queue head for ledger tasks');
    assert(ledgerClaim.messages.some((entry) => entry.code === 'ATM_TASK_DELIVERY_PRINCIPLE'), 'next --claim must remind agents that the claimed task must be delivered before closure');
    assert((ledgerClaim.evidence.taskDirectionLock as any)?.schemaId === 'atm.taskDirectionLock.v1', 'next --claim must persist atm.taskDirectionLock.v1');
    assert((ledgerClaim.evidence.nextAction as any).playbook?.state === 'queue-head-active', 'claimed batch route must mark the playbook as queue-head-active');
    assert((ledgerClaim.evidence.nextAction as any).deliveryPrinciple?.notAllowedAsCompletion?.some((entry: string) => entry.includes('.atm/history')), 'next --claim delivery principle must reject ledger-only completion');
    assert((ledgerClaim.evidence.batchRun as any)?.schemaId === 'atm.batchRun.v1', 'batch claim must persist atm.batchRun.v1');
    const ledgerClaimTrail = assertDecisionTrail(ledgerClaim.evidence.nextAction as any, 'claimed batch route');
    assert(ledgerClaimTrail.some((entry) => entry.check === 'task-direction-lock' && entry.result === 'pass'), 'claimed route decisionTrail must record task direction lock evidence');
    const ledgerBatchId = (ledgerClaim.evidence.batchRun as any)?.batchId;
    assert(typeof ledgerBatchId === 'string' && ledgerBatchId.length > 0, 'batch claim must return a stable batchId');
    const lockPath = path.join(tempRoot, '.atm', 'runtime', 'locks', 'TASK-LEDGER-0001.lock.json');
    assert(existsSync(lockPath), 'direction lock must be embedded in the runtime lock file');
    const lockDocument = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert(lockDocument.taskDirectionLock?.taskId === 'TASK-LEDGER-0001', 'runtime lock must include the selected task direction lock');
    assert(lockDocument.taskDirectionLock?.batchId === ledgerBatchId, 'direction lock must carry the batchId');
    const batchStatus = await runBatch(['status', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((batchStatus.evidence.batchRun as any)?.currentTaskId === 'TASK-LEDGER-0001', 'batch status must point at the claimed queue head');
    const compactBatchStatus = await runBatch(['current', '--cwd', tempRoot, '--batch', ledgerBatchId, '--compact', '--json']);
    assert((compactBatchStatus.evidence.current as any)?.schemaId === 'atm.batchCurrent.v1', 'batch current --compact must return the compact current schema');
    assert((compactBatchStatus.evidence.current as any)?.currentTaskId === 'TASK-LEDGER-0001', 'compact batch current must point at the queue head');
    assert(Array.isArray((compactBatchStatus.evidence.current as any)?.allowedFiles), 'compact batch current must include allowedFiles');
    assert((compactBatchStatus.evidence as any).batchRun === undefined, 'compact batch current must omit the full batchRun payload');
    assert((compactBatchStatus.evidence as any).taskQueue === undefined, 'compact batch current must omit the full taskQueue payload');
    assert(String((compactBatchStatus.evidence.current as any)?.commands?.checkpoint ?? '').includes(`--batch ${ledgerBatchId}`), 'compact batch current must include a batch-specific checkpoint command');
    const activeBatchExact = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-LEDGER-0002']);
    assert(activeBatchExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'exact task id inside an active batch must stay in queue routing');
    assert((activeBatchExact.evidence.nextAction as any).recommendedChannel === 'batch', 'exact task id inside an active batch must recommend batch channel');
    assert((activeBatchExact.evidence.nextAction as any).queueHeadTaskId === 'TASK-LEDGER-0001', 'active batch exact route must still point at the current queue head');
    assert(String((activeBatchExact.evidence.nextAction as any).requiredCommand ?? '').includes(ledgerPrompt), 'active batch exact route must redirect claim back to the original batch prompt');
    const activeBatchFamily = await runNext(['--cwd', tempRoot, '--prompt', 'Please continue remaining LEDGER task cards one by one']);
    assert(activeBatchFamily.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'alternate same-family prompt inside an active batch must stay in queue routing');
    assert((activeBatchFamily.evidence.nextAction as any).queueHeadTaskId === 'TASK-LEDGER-0001', 'alternate same-family prompt must keep the active batch queue head');
    assert(String((activeBatchFamily.evidence.nextAction as any).requiredCommand ?? '').includes(ledgerPrompt), 'alternate same-family prompt must redirect claim back to the original batch prompt');
    const activeBatchClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-LEDGER-0002']);
    assert((activeBatchClaim.evidence.nextAction as any).selectedTask.workItemId === 'TASK-LEDGER-0001', 'active batch next --claim must claim the current queue head, not the later exact task prompt');
    assert((activeBatchClaim.evidence.nextAction as any).recommendedChannel === 'batch', 'active batch next --claim must stay in batch channel');
    let directBatchCloseBlocked = false;
    try {
      await runTasks(['close', '--cwd', tempRoot, '--task', 'TASK-LEDGER-0001', '--actor', 'prompt-scope-test', '--status', 'done']);
    } catch (error) {
      directBatchCloseBlocked = (error as { code?: string }).code === 'ATM_BATCH_CHECKPOINT_REQUIRED';
    }
    assert(directBatchCloseBlocked, 'active batch queue head must be closed through batch checkpoint, not direct tasks close');
    let directLaterBatchCloseBlocked = false;
    try {
      await runTasks(['close', '--cwd', tempRoot, '--task', 'TASK-LEDGER-0002', '--actor', 'prompt-scope-test', '--status', 'done']);
    } catch (error) {
      directLaterBatchCloseBlocked = (error as { code?: string }).code === 'ATM_BATCH_CHECKPOINT_REQUIRED';
    }
    assert(directLaterBatchCloseBlocked, 'later tasks inside an active batch must also be closed through batch checkpoint, not direct tasks close');
    const batchRunPath = path.join(tempRoot, '.atm', 'runtime', 'batch-runs', `${ledgerBatchId}.json`);
    const corruptedBatchRun = JSON.parse(readFileSync(batchRunPath, 'utf8'));
    corruptedBatchRun.taskIds = ['TASK-LEDGER-0002'];
    corruptedBatchRun.currentIndex = 0;
    corruptedBatchRun.currentTaskId = 'TASK-LEDGER-0002';
    writeFileSync(batchRunPath, `${JSON.stringify(corruptedBatchRun, null, 2)}\n`, 'utf8');
    const brokenBatchStatus = await runBatch(['status', '--cwd', tempRoot, '--json']);
    assert(brokenBatchStatus.ok === false, 'batch status must fail when batch-run and task-queue disagree');
    assert(brokenBatchStatus.messages.some((entry) => entry.code === 'ATM_BATCH_STATE_REPAIR_REQUIRED'), 'broken batch status must require repair');
    const brokenBatchNext = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-LEDGER-0002']);
    assert(brokenBatchNext.ok === false, 'next must not continue through an inconsistent active batch');
    assert(brokenBatchNext.messages.some((entry) => entry.code === 'ATM_BATCH_STATE_REPAIR_REQUIRED'), 'next must return the batch repair route when runtime is inconsistent');
    assert((brokenBatchNext.evidence.nextAction as any).playbook?.state === 'repair-required', 'repair route must mark the playbook as repair-required');
    const repairBatch = await runBatch(['repair', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--batch', ledgerBatchId, '--json']);
    assert(repairBatch.ok === true, 'batch repair must succeed for a queue-backed inconsistent batch');
    assert((repairBatch.evidence.after as any)?.taskIds?.includes('TASK-LEDGER-0001'), 'batch repair must restore the full task queue task list');
    assert((repairBatch.evidence.after as any)?.currentTaskId === 'TASK-LEDGER-0001', 'batch repair must restore the queue head as current task');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0001.json'), 'TASK-RANGE-0001', 'Range first task', 'docs/range-one.md');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0002.json'), 'TASK-RANGE-0002', 'Range second task', 'docs/range-two.md');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0003.json'), 'TASK-RANGE-0003', 'Range third task', 'docs/range-three.md');
    const explicitRangeClaim = await runNext([
      '--cwd', tempRoot,
      '--claim',
      '--actor', 'prompt-scope-test',
      '--prompt', 'complete selected range',
      '--tasks', 'TASK-RANGE-0003,TASK-RANGE-0001,TASK-RANGE-0002'
    ]);
    const rangeBatch = (explicitRangeClaim.evidence.batchRun as any) ?? {};
    assert(rangeBatch.currentTaskId === 'TASK-RANGE-0003', 'explicit --tasks batch must preserve the caller supplied order');
    assert(JSON.stringify(rangeBatch.taskIds) === JSON.stringify(['TASK-RANGE-0003', 'TASK-RANGE-0001', 'TASK-RANGE-0002']), 'explicit --tasks taskIds must be frozen in order');
    const activeBatchesAfterRangeClaim = listActiveBatchRuns(tempRoot);
    assert(activeBatchesAfterRangeClaim.length >= 2, `explicit --tasks claim must coexist with the existing ledger batch, got ${activeBatchesAfterRangeClaim.map((entry) => entry.batchId).join(',')}`);
    const multiBatchStatus = await runBatch(['status', '--cwd', tempRoot, '--json']);
    assert(multiBatchStatus.ok === false, 'batch status without selector must not guess when multiple active batches exist');
    assert(multiBatchStatus.messages.some((entry) => entry.code === 'ATM_BATCH_SELECTION_REQUIRED'), 'multiple active batches must require --batch or --scope selection');
    const compactMultiBatchStatus = await runBatch(['current', '--cwd', tempRoot, '--compact', '--json']);
    assert(compactMultiBatchStatus.ok === false, 'compact batch current without selector must not guess when multiple active batches exist');
    assert((compactMultiBatchStatus.evidence as any).compact === true, 'compact multi-batch selection response must stay compact');
    assert(Array.isArray((compactMultiBatchStatus.evidence as any).candidates), 'compact multi-batch selection response must list compact candidates');
    assert((compactMultiBatchStatus.evidence as any).activeBatches === undefined, 'compact multi-batch selection response must omit full activeBatches');
    assert((compactMultiBatchStatus.evidence as any).candidates.every((entry: any) => Array.isArray(entry.taskIds) === false), 'compact candidates must not include full task id arrays');
    const selectedRangeStatus = await runBatch(['status', '--cwd', tempRoot, '--batch', rangeBatch.batchId, '--json']);
    assert((selectedRangeStatus.evidence.batchRun as any)?.currentTaskId === 'TASK-RANGE-0003', 'batch status --batch must select the requested batch');
    await runBatch(['abandon', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--batch', rangeBatch.batchId, '--json']);
    const rangeAfterAbandon = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-RANGE-0002']);
    assert(rangeAfterAbandon.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'abandoned batch queue must not be reused by exact task routing');
    assert((rangeAfterAbandon.evidence.nextAction as any).recommendedChannel === 'normal', 'abandoned batch queue must not keep exact task prompts in batch mode');
    assert((rangeAfterAbandon.evidence.nextAction as any).selectedTask?.workItemId === 'TASK-RANGE-0002', 'exact task after batch abandon must route to the requested task');

    writeLedgerTask(path.join(ledgerTaskDir, 'SANGUO-BOOTSTRAP-0001.json'), 'SANGUO-BOOTSTRAP-0001', 'Running Sanguo bootstrap task', 'docs/sanguo.md', {
      status: 'running',
      claimActorId: 'prompt-scope-test'
    });
    const runningExact = await runNext(['--cwd', tempRoot, '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to a running task with active claim');
    assert((runningExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'exact running task prompt selected wrong task');
    const runningClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningClaim.ok === true, 'next --claim must reuse an active claim for a running task');
    assert((runningClaim.evidence.claimPreparation as any)?.reusedActiveClaim === true, 'running task claim should be reported as reused active claim');
    assert((runningClaim.evidence.taskDirectionLock as any)?.taskId === 'SANGUO-BOOTSTRAP-0001', 'running task claim must still write a direction lock');
    const runningAllowedFiles = (runningClaim.evidence.taskDirectionLock as any)?.allowedFiles ?? [];
    assert(runningAllowedFiles.includes('docs/sanguo.md'), 'direction lock allowedFiles must preserve real task paths');
    assert(!runningAllowedFiles.some((entry: string) => entry.includes('human gate')), 'direction lock allowedFiles must not include natural-language acceptance text');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0001.json'), 'TASK-DEP-0001', 'Unfinished dependency', 'docs/dep.md', {
      status: 'planned'
    });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0041.json'), 'TASK-DEP-0041', 'Ready task with hard dependency', 'docs/dep-0041.md', {
      status: 'ready',
      dependencies: ['TASK-DEP-0001']
    });
    const dependencyBlockedNextClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-DEP-0041']);
    assert(dependencyBlockedNextClaim.ok === false, 'next --claim must block when a task dependency is not yet closed');
    assert(dependencyBlockedNextClaim.messages.some((entry) => entry.code === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED'), 'next --claim must report dependency-blocked guidance');
    const dependencyBlockedTasksClaim = await runTasks(['claim', '--cwd', tempRoot, '--task', 'TASK-DEP-0041', '--actor', 'prompt-scope-test', '--json']).catch((error: any) => ({ ok: false, error }));
    const dependencyBlockedTasksClaimError = (dependencyBlockedTasksClaim as any).error;
    assert(dependencyBlockedTasksClaimError && dependencyBlockedTasksClaimError.code === 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED', 'tasks claim must fail when a task dependency is not yet closed');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0040.json'), 'TASK-DEP-0040', 'Explicit running task with advisory dependency', 'docs/dep-0040.md', {
      status: 'running',
      claimActorId: 'prompt-scope-test',
      dependencies: ['TASK-DEP-0001']
    });
    const explicitRunningWithDependencyClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-DEP-0040']);
    assert(explicitRunningWithDependencyClaim.ok === true, 'explicit running task claim must recreate direction lock even when advisory dependencies are not complete');
    assert((explicitRunningWithDependencyClaim.evidence.taskDirectionLock as any)?.taskId === 'TASK-DEP-0040', 'explicit running task claim with advisory dependency must lock the requested task');

    const crossClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-CROSS-0001']);
    assert(crossClaim.ok === true, 'cross-repo ledger task claim must succeed');
    const crossLock = (crossClaim.evidence.taskDirectionLock as any) ?? {};
    assert((crossClaim.evidence.nextAction as any).planningContext?.readOnlyPaths?.some((entry: string) => entry.includes('../3KLife/docs/ai_atomic_framework/atm-agent-first-operability')), 'next --claim must surface planningContext.readOnlyPaths');
    assert((crossClaim.evidence.nextAction as any).targetWork?.allowedFiles?.includes('packages/cli/src/commands/next.ts'), 'next --claim must surface targetWork.allowedFiles');
    assert(!((crossClaim.evidence.nextAction as any).targetWork?.allowedFiles ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/')), 'targetWork.allowedFiles must exclude planning mirror files');
    assert((crossLock.allowedFiles ?? []).includes('packages/cli/src/commands/next.ts'), 'direction lock must keep real target files');
    assert(!((crossLock.allowedFiles ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/'))), 'direction lock allowedFiles must exclude planning mirror files');
    assert((crossLock.planningMirrorPaths ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/')), 'direction lock must record planning mirror guard paths');

    // Regression: TASK-AAO-0038 import contract fidelity — nested evidence/rollback, legacy alias diagnostics.
    writeFileSync(path.join(taskDir, 'TASK-FIDELITY-0001.task.md'), `---
task_id: TASK-FIDELITY-0001
title: Import contract fidelity card
status: planned
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/tasks.ts"
deliverables:
  - "packages/cli/src/commands/tasks.ts"
validators:
  - "npm run typecheck"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Restore previous projection if import regresses."
atomizationImpact:
  ownerAtomOrMap: "atm.task-ledger-governance-map"
  mapUpdates:
    - "atomic_workbench/atomization-coverage/path-to-atom-map.json"
---
# TASK-FIDELITY-0001
`, 'utf8');
    const fidelityImport = await runTasks(['import', '--cwd', tempRoot, '--from', path.join('docs', 'plan', 'tasks', 'TASK-FIDELITY-0001.task.md'), '--dry-run', '--json']);
    const fidelityManifest = (fidelityImport.evidence as any).manifest ?? {};
    const fidelityTask = Array.isArray(fidelityManifest.tasks) ? fidelityManifest.tasks[0] : null;
    assert(fidelityTask, 'tasks import --dry-run must parse nested evidence/rollback task card');
    assert(fidelityTask.evidenceRequired === 'command-backed', 'tasks import must unpack nested evidence.required');
    assert(fidelityTask.rollbackStrategy === 'revert-commit', 'tasks import must unpack nested rollback.strategy');
    assert(fidelityTask.rollbackNotes && fidelityTask.rollbackNotes.includes('Restore previous projection'), 'tasks import must unpack nested rollback.notes');
    assert(fidelityTask.atomizationImpact?.ownerAtomOrMap === 'atm.task-ledger-governance-map', 'tasks import must unpack nested atomizationImpact.ownerAtomOrMap');
    assert(Array.isArray(fidelityTask.atomizationImpact?.mapUpdates) && fidelityTask.atomizationImpact.mapUpdates.includes('atomic_workbench/atomization-coverage/path-to-atom-map.json'), 'tasks import must unpack nested atomizationImpact.mapUpdates');
    assert(fidelityTask.targetRepo === 'AI-Atomic-Framework', 'tasks import must preserve targetRepo');
    assert(fidelityTask.closureAuthority === 'target_repo', 'tasks import must preserve closureAuthority');

    // Regression: legacy allowed_files alias must produce an import diagnostic.
    writeFileSync(path.join(taskDir, 'TASK-LEGACY-0001.task.md'), `---
task_id: TASK-LEGACY-0001
title: Legacy alias card
status: planned
target_repo: AI-Atomic-Framework
allowed_files:
  - "packages/cli/src/commands/tasks.ts"
---
# TASK-LEGACY-0001
`, 'utf8');
    const legacyImport = await runTasks(['import', '--cwd', tempRoot, '--from', path.join('docs', 'plan', 'tasks', 'TASK-LEGACY-0001.task.md'), '--dry-run', '--json']);
    const legacyManifest = (legacyImport.evidence as any).manifest ?? {};
    const legacyTask = Array.isArray(legacyManifest.tasks) ? legacyManifest.tasks[0] : null;
    assert(legacyTask, 'tasks import --dry-run must parse legacy allowed_files card');
    assert(Array.isArray(legacyTask.scopePaths) && legacyTask.scopePaths.includes('packages/cli/src/commands/tasks.ts'), 'legacy allowed_files must project to scopePaths');
    const legacyDiagnostics = Array.isArray(legacyTask.importDiagnostics) ? legacyTask.importDiagnostics : [];
    assert(legacyDiagnostics.some((entry: any) => entry?.code === 'ATM_TASK_IMPORT_LEGACY_ALIAS' && entry?.alias === 'allowed_files'), 'legacy allowed_files alias must emit ATM_TASK_IMPORT_LEGACY_ALIAS diagnostic');
    assert(legacyTask.legacyImportAliases?.allowed_files, 'legacy alias projection must retain allowed_files lineage');

    // Regression: planning_repo authority + different target_repo must route to mirror-sync-only.
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-PLANNING-0001.json'), 'TASK-PLANNING-0001', 'Planning-only stale mirror', 'docs/planning-only.md', {
      status: 'planned',
      sourcePlanPath: path.relative(tempRoot, path.join(externalTaskDir, 'TASK-PLANNING-0001.task.md')).replace(/\\/g, '/'),
      scopePaths: ['docs/planning-only.md'],
      targetRepo: 'PlanningRepo',
      closureAuthority: 'planning_repo',
      planningRepo: 'PlanningRepo'
    });
    writeFileSync(path.join(externalTaskDir, 'TASK-PLANNING-0001.task.md'), `---
task_id: TASK-PLANNING-0001
title: Planning-only mirror source card
status: done
target_repo: PlanningRepo
planning_repo: PlanningRepo
closure_authority: planning_repo
scopePaths:
  - "docs/planning-only.md"
---
# TASK-PLANNING-0001
`, 'utf8');
    const planningRoute = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-PLANNING-0001']);
    assert(planningRoute.ok === true, 'planning_repo-authority task lookup must still succeed');
    assert(planningRoute.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED'), 'planning_repo authority + different target_repo must emit ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED');
    const planningNextAction = (planningRoute.evidence.nextAction as any) ?? {};
    assert(planningNextAction.status === 'task-mirror-sync-required', 'planning_repo authority must produce task-mirror-sync-required next action');
    assert(planningNextAction.recommendedChannel === 'mirror-sync', 'planning_repo authority must recommend mirror-sync channel, not normal/batch');
    assert(planningNextAction.deliveryClassification?.intent === 'mirror-sync-only', 'planning_repo authority must classify as mirror-sync-only');
    assert(planningNextAction.deliveryClassification?.statusDivergence === true, 'planning_repo authority with stale ledger must record statusDivergence');
    assert(planningNextAction.deliveryClassification?.sourceStatus === 'done', 'planning_repo authority must read source-card status (done) from the source task card');
    assert(typeof planningNextAction.requiredCommand === 'string' && planningNextAction.requiredCommand.includes('tasks import') && planningNextAction.requiredCommand.includes('--write') && planningNextAction.requiredCommand.includes('--force'), 'planning_repo authority must recommend tasks import --write --force as required command');
    const planningClaimBlocked = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-PLANNING-0001']).catch((error: any) => ({ ok: false, error }));
    const planningClaimError = (planningClaimBlocked as any).error;
    assert(planningClaimError && planningClaimError.code === 'ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED', 'next --claim on a planning_repo-authority task must throw ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED');

    const ambiguous = await runNext(['--cwd', tempRoot, '--prompt', 'Please do the next task card']);
    assert(ambiguous.ok === false, 'ambiguous task-card prompt must not route as ok');
    assert(ambiguous.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SELECTION_REQUIRED'), 'ambiguous task-card prompt must ask for task selection');
    const ambiguousTrail = assertDecisionTrail(ambiguous.evidence.nextAction as any, 'task-selection-required');
    assert(ambiguousTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'blocked'), 'ambiguous route decisionTrail must record selection requirement');

    const nonTaskPrompt = await runNext(['--cwd', tempRoot, '--prompt', 'Please show onboarding guidance']);
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'non-task prompt must route to prompt-scoped guidance');

    const noPrompt = await runNext(['--cwd', tempRoot]);
    assert(noPrompt.ok === false, 'next without prompt must not proceed when non-bootstrap tasks exist');
    assert(noPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_REQUIRED_FOR_TASK_ROUTING'), 'next without prompt must require the current user prompt for task routing');
    assert((noPrompt.evidence.nextAction as any).batchInstruction?.includes('recommendedChannel=batch'), 'next without prompt must explain that batch needs the original prompt');

    // Regression: Parallel CID advisor preflight and team validation integration tests
    writeFileSync(path.join(atomizationCoverageDir, 'path-to-atom-map.json'), JSON.stringify({
      mappings: [
        {
          path_pattern: 'src/conflict-file.ts',
          atom_id: 'atom-conflict',
          capability: 'conflict'
        }
      ]
    }, null, 2), 'utf8');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-CONFLICT-0001.json'), 'TASK-CONFLICT-0001', 'Active conflict task', 'src/conflict-file.ts', {
      status: 'running',
      claimActorId: 'other-actor'
    });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-CONFLICT-0002.json'), 'TASK-CONFLICT-0002', 'Blocked conflict task', 'src/conflict-file.ts', {
      status: 'ready'
    });

    const conflictClaimBlocked = await runNext([
      '--cwd', tempRoot,
      '--claim',
      '--actor', 'prompt-scope-test',
      '--prompt', 'TASK-CONFLICT-0002'
    ]).catch((error: any) => ({ ok: false, error }));
    const conflictClaimError = (conflictClaimBlocked as any).error;
    assert(conflictClaimError && conflictClaimError.code === 'ATM_NEXT_CLAIM_BLOCKED', 'next --claim on CID conflict task must throw ATM_NEXT_CLAIM_BLOCKED');
    assert(conflictClaimError.details?.conflictWithTaskId === 'TASK-CONFLICT-0001', 'details must report conflict task id');
    assert(conflictClaimError.details?.verdict === 'blocked-cid-conflict', 'details must report verdict blocked-cid-conflict');

    const teamPlanResult = await runTeam(['plan', '--task', 'TASK-CONFLICT-0002', '--cwd', tempRoot, '--json']);
    assert(teamPlanResult.ok === false, 'team plan with CID conflict must fail validation');
    const teamEvidence = teamPlanResult.evidence as any;
    assert(teamEvidence?.validation?.ok === false, 'validation ok must be false');
    assert(teamEvidence?.validation?.findings?.some((f: any) => f.code === 'blocked-cid-conflict'), 'findings must include blocked-cid-conflict');
    assert(teamEvidence?.teamPlan?.briefingContract?.parallelAdvisory?.verdict === 'blocked-cid-conflict', 'briefing contract must carry parallelAdvisory');
  } finally {
    if (previousGitCeilingDirectories === undefined) {
      delete process.env.GIT_CEILING_DIRECTORIES;
    } else {
      process.env.GIT_CEILING_DIRECTORIES = previousGitCeilingDirectories;
    }
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(path.join(path.dirname(tempRoot), '3KLife'), { recursive: true, force: true });
  }
}

function writeTaskCard(filePath: string, taskId: string, title: string, options: { readonly status?: string; readonly relatedPlan?: string; readonly files?: string } = {}) {
  writeFileSync(filePath, `---
task_id: ${taskId}
title: ${title}
status: ${options.status ?? 'planned'}
target_repo: AI-Atomic-Framework
closure_authority: target_repo
${options.relatedPlan ? `related_plan: ${options.relatedPlan}\n` : ''}
${options.files ? `files: ${options.files}\n` : ''}
---
# ${taskId}
`, 'utf8');
}

function writeLedgerTask(filePath: string, taskId: string, title: string, scopePath: string, options: { readonly status?: string; readonly claimActorId?: string; readonly scopePaths?: readonly string[]; readonly sourcePlanPath?: string; readonly closedAt?: string; readonly closedByActor?: string; readonly closurePacket?: string; readonly dependencies?: readonly string[]; readonly targetRepo?: string; readonly closureAuthority?: string; readonly planningRepo?: string } = {}) {
  writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: options.status ?? 'ready',
    dependencies: options.dependencies ?? [],
    acceptance: ['bootstrap output reviewed by human gate'],
    scope: options.scopePaths ?? [scopePath],
    scopePaths: options.scopePaths ?? [scopePath],
    deliverables: options.scopePaths ?? [scopePath],
    ...(options.closurePacket ? { closurePacket: options.closurePacket } : {}),
    ...(options.closedAt ? { closedAt: options.closedAt } : {}),
    ...(options.closedByActor ? { closedByActor: options.closedByActor } : {}),
    ...(options.targetRepo ? { targetRepo: options.targetRepo } : {}),
    ...(options.closureAuthority ? { closureAuthority: options.closureAuthority } : {}),
    ...(options.planningRepo ? { planningRepo: options.planningRepo } : {}),
    ...(options.claimActorId ? {
      claim: {
        actorId: options.claimActorId,
        leaseId: `lease-${taskId.toLowerCase()}`,
        claimedAt: '2026-05-24T00:00:00.000Z',
        heartbeatAt: '2026-05-24T00:00:00.000Z',
        ttlSeconds: 1800,
        files: [scopePath],
        state: 'active'
      }
    } : {}),
    source: {
      planPath: options.sourcePlanPath ?? 'docs/plan/PlanAlpha.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  }, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
