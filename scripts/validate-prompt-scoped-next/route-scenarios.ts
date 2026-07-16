import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../../packages/cli/src/commands/quickfix.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { listActiveBatchRuns } from '../../packages/cli/src/commands/work-channels.ts';
import { assert, assertDecisionTrail, assertRunnerMode, assertTeamRecommendation, runGit } from './assertions.ts';
import { writeLedgerTask, writeTaskCard } from './writers.ts';

export async function runRouteScenarios(ctx: any) {
  const { tempRoot, taskDir, externalTaskDir } = ctx;
    const exact = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-ALPHA-0001']);
    assert(exact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to one task');
    assert((exact as any).nextAction === undefined, 'default next output must omit duplicated top-level nextAction alias');
    assert((exact as any).taskIntent === undefined, 'default next output must omit duplicated top-level taskIntent alias');
    assert((exact as any).allowedCommands === undefined, 'default next output must omit duplicated top-level allowedCommands alias');
    assert(JSON.stringify(exact).length < 45000, 'default next output must stay compact enough for agent transcripts');
    assert((exact.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'exact task id prompt selected wrong task');
    assert((exact.evidence.nextAction as any).recommendedChannel === 'normal', 'exact task id prompt must recommend normal channel');
    const exactTrail = assertDecisionTrail(exact.evidence.nextAction as any, 'task-route-ready');
    assert(exactTrail.some((entry) => entry.check === 'task-selection' && entry.result === 'pass'), 'exact task route decisionTrail must record task selection');
    assertTeamRecommendation(exact.evidence.nextAction as any, 'normal', 'TASK-ALPHA-0001');
    assert(exact.messages.some((entry) => entry.code === 'ATM_TEAM_RECOMMENDATION'), 'task route must emit team recommendation advisory');

    const exactVerbose = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-ALPHA-0001', '--verbose']);
    const compactPlaybookMessage = exact.messages.find((entry) => entry.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED') as any;
    const verbosePlaybookMessage = exactVerbose.messages.find((entry) => entry.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED') as any;
    assert(compactPlaybookMessage?.data?.fullPlaybookPath === 'evidence.nextAction.playbook', 'default next output must point duplicated playbook message data at evidence.nextAction.playbook');
    assert(compactPlaybookMessage?.data?.steps === undefined, 'default next output must omit duplicated playbook steps from message data');
    assert(Array.isArray(verbosePlaybookMessage?.data?.steps), 'next --verbose must retain full playbook steps in message data');

    const explicitTask = await runNext(['--cwd', tempRoot, '--task', 'TASK-ALPHA-0001']);
    assert(explicitTask.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'next --task must route to one task');
    assert((explicitTask.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'next --task selected wrong task');
    assert((explicitTask.evidence.nextAction as any).recommendedChannel === 'normal', 'next --task must recommend normal channel');
    assert(String((explicitTask.evidence.nextAction as any).requiredCommand).includes('tasks import'), 'next --task for a markdown planning card must import before claim');
    assert(String((explicitTask.evidence.nextAction as any).taskScopedClaimCommand).includes('--task TASK-ALPHA-0001'), 'next --task must still expose the eventual task-scoped claim command');
    assertRunnerMode(explicitTask);

    const genericExact = await runNext(['--cwd', tempRoot, '--prompt', '請處理 SANGUO-BOOTSTRAP-0001']);
    assert(genericExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'generic governed task id prompt must route to one task');
    assert((genericExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'generic governed task id prompt selected wrong task');

    const ignoredTmpExact = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-TMP-0001']);
    assert(!ignoredTmpExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'task discovery must ignore task cards under local/tmp');

    const quickfixPrompt = '請小修 tsconfig.json typo';
    const quickfixRoute = await runNext(['--cwd', tempRoot, '--prompt', quickfixPrompt]);
    assert(quickfixRoute.messages.some((entry) => entry.code === 'ATM_NEXT_QUICKFIX_ROUTE_READY'), 'quickfix prompt must route to the fast channel');
    assert(quickfixRoute.messages.some((entry) => entry.code === 'ATM_NEXT_GOVERNANCE_READINESS_HINT'), 'quickfix prompt must emit early governance readiness hints');
    assert((quickfixRoute.evidence.nextAction as any).recommendedChannel === 'fast', 'quickfix route must recommend fast channel');
    assert(Array.isArray((quickfixRoute.evidence.nextAction as any).governanceReadiness?.earlyPreparation), 'quickfix route must expose governanceReadiness.earlyPreparation');
    const quickfixClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', quickfixPrompt]);
    assert(quickfixClaim.ok === true, 'quickfix next --claim must succeed');
    assert((quickfixClaim.evidence.quickfixLock as any)?.schemaId === 'atm.quickfixLock.v1', 'quickfix next --claim must persist atm.quickfixLock.v1');
    const quickfixStatus = await runQuickfix(['status', '--cwd', tempRoot, '--json']);
    assert((quickfixStatus.evidence.lock as any)?.actorId === 'prompt-scope-test', 'quickfix status must report the active lock');
    const quickfixRelease = await runQuickfix(['release', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((quickfixRelease.evidence.lock as any)?.status === 'released', 'quickfix release must mark the lock as released');

    const frameworkRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'prompt-scoped-framework-'));
    try {
      mkdirSync(path.join(frameworkRoot, 'packages', 'cli', 'src'), { recursive: true });
      mkdirSync(path.join(frameworkRoot, 'packages', 'core', 'src'), { recursive: true });
      writeFileSync(path.join(frameworkRoot, 'package.json'), `${JSON.stringify({ name: 'ai-atomic-framework' }, null, 2)}\n`, 'utf8');
      writeFileSync(path.join(frameworkRoot, 'packages', 'cli', 'src', 'atm.ts'), 'export {};\n', 'utf8');
      writeFileSync(path.join(frameworkRoot, 'packages', 'core', 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFileSync(path.join(frameworkRoot, 'atomic-registry.json'), '{}\n', 'utf8');
      runGit(frameworkRoot, ['init']);
      runGit(frameworkRoot, ['config', 'user.name', 'prompt-scope-validator']);
      runGit(frameworkRoot, ['config', 'user.email', 'prompt-scope-validator@example.com']);
      runGit(frameworkRoot, ['add', '.']);
      runGit(frameworkRoot, ['commit', '-m', 'framework fixture baseline']);
      const frameworkPrompt = '修正 ATM backlog 中最嚴重卡住治理的 bug';
      const frameworkRoute = await runNext(['--cwd', frameworkRoot, '--prompt', frameworkPrompt]);
      const frameworkAction = frameworkRoute.evidence.nextAction as any;
      assert(frameworkRoute.messages.some((entry) => entry.code === 'ATM_NEXT_FRAMEWORK_TEMP_CLAIM_REQUIRED'), 'framework maintenance prompt must require framework temp claim');
      assert(String(frameworkAction?.command ?? '').includes('framework-mode claim'), 'framework maintenance route command must use framework-mode claim');
      assert(String(frameworkAction?.playbook?.steps?.[0] ?? '').includes('framework-mode claim'), 'framework fast playbook first step must use framework-mode claim');
      assert(!String(frameworkAction?.playbook?.steps?.[0] ?? '').includes('next --claim'), 'framework fast playbook must not send no-task routes through next --claim');

      const backlogCloseout = await runNext(['--cwd', frameworkRoot, '--prompt', 'Resolve ATM-BUG-2026-07-07-048 and push the fix']);
      assert(backlogCloseout.ok === true, 'backlog closeout prompts must not be treated as missing ledger tasks');
      assert(!backlogCloseout.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'backlog closeout prompts must not emit task-scope-not-found');
      assert(backlogCloseout.messages.some((entry) => entry.code === 'ATM_NEXT_FRAMEWORK_TEMP_CLAIM_REQUIRED'), 'backlog closeout prompts must route to framework temp claim');
      assert((backlogCloseout.evidence.taskIntent as any)?.taskScopeMentioned === false, 'backlog identifiers must not be normalized as ledger task ids');
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }

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
    assert(queue.messages.some((entry) => entry.code === 'ATM_NEXT_GOVERNANCE_READINESS_HINT'), 'plan-scoped queue route must emit early governance readiness hints');
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

    const retrospectiveAudit = await runNext(['--cwd', tempRoot, '--prompt', 'Please audit OPT-12 follow-up cleanup status and report whether the review is complete']);
    assert(retrospectiveAudit.ok === true, 'read-only retrospective audit prompts with historical non-ledger labels must not hard-block as task-scope-not-found');
    assert(retrospectiveAudit.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_AUDIT_ADVISORY'), 'retrospective audit prompt must report the missing historical scope as advisory');
    assert(!retrospectiveAudit.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'retrospective audit prompt must not emit the hard task-scope-not-found blocker');
    assert((retrospectiveAudit.evidence.nextAction as any).status === 'task-scope-audit-advisory', 'retrospective audit prompt must expose the advisory route status');
    const retrospectiveAuditTrail = assertDecisionTrail(retrospectiveAudit.evidence.nextAction as any, 'retrospective audit advisory');
    assert(retrospectiveAuditTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'info'), 'audit advisory decisionTrail must record non-blocking scope resolution');

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

    const fableShorthand = await runNext(['--cwd', tempRoot, '--prompt', '回報 Fable5 交接的 FABLE-004 是否完成']);
    assert((fableShorthand.evidence.nextAction as any)?.selectedTask?.workItemId === 'TASK-AAO-FABLE-004', 'FABLE-004 shorthand must resolve to the unique imported AAO FABLE task');
    assert(!fableShorthand.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'FABLE-004 shorthand must not be reported as task-scope-not-found');

    const aaoFableShorthand = await runNext(['--cwd', tempRoot, '--prompt', 'check AAO-FABLE-005 status']);
    assert((aaoFableShorthand.evidence.nextAction as any)?.selectedTask?.workItemId === 'TASK-AAO-FABLE-005', 'AAO-FABLE-005 shorthand must resolve to the matching TASK-AAO-FABLE-005 ledger task');
    assert(!aaoFableShorthand.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'AAO-FABLE-005 shorthand must not be reported as task-scope-not-found');

    const zhBacklogContinuationPrompt = '\u8acb\u7e7c\u7e8c\u4fee\u5fa9\u6240\u6709 backlog\uff0c\u904e\u7a0b\u4e2d\u5361\u4f4f\u7684\u5730\u65b9\u90fd\u56de\u5beb backlog';
    const zhBacklogContinuation = await runNext(['--cwd', tempRoot, '--prompt', zhBacklogContinuationPrompt]);
    assert((zhBacklogContinuation.evidence.taskIntent as any)?.queueRequested === true, 'zh-TW backlog continuation prompt must set taskIntent.queueRequested');
    assert(zhBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'zh-TW backlog continuation prompt must route to the task queue');
    assert((zhBacklogContinuation.evidence.nextAction as any).recommendedChannel === 'batch', 'zh-TW backlog continuation prompt must recommend batch channel');
    assert(!zhBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'zh-TW backlog continuation prompt must not fall back to prompt guidance/create-atom');

    const englishBacklogContinuation = await runNext(['--cwd', tempRoot, '--prompt', 'continue backlog fixes and record any workflow friction']);
    assert((englishBacklogContinuation.evidence.taskIntent as any)?.queueRequested === true, 'English backlog fixes continuation prompt must set taskIntent.queueRequested');
    assert(englishBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'English backlog fixes continuation prompt must route to the task queue');
    assert((englishBacklogContinuation.evidence.nextAction as any).recommendedChannel === 'batch', 'English backlog fixes continuation prompt must recommend batch channel');
    assert(!englishBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'English backlog fixes continuation prompt must not fall back to prompt guidance/create-atom');

    const captainBacklogContinuation = await runNext(['--cwd', tempRoot, '--prompt', 'Captain mode: continue backlog repairs one by one']);
    assert((captainBacklogContinuation.evidence.taskIntent as any)?.queueRequested === true, 'Captain backlog repair continuation prompt must set taskIntent.queueRequested');
    assert(captainBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'Captain backlog repair continuation prompt must route to the task queue');
    assert((captainBacklogContinuation.evidence.nextAction as any).recommendedChannel === 'batch', 'Captain backlog repair continuation prompt must recommend batch channel');
    assert(!captainBacklogContinuation.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'Captain backlog repair continuation prompt must not fall back to prompt guidance/create-atom');

    const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-root-missing-'));
    mkdirSync(path.join(isolatedRoot, '.atm'), { recursive: true });
    writeFileSync(path.join(isolatedRoot, '.atm', 'config.json'), `${JSON.stringify({
      schemaVersion: 'atm.config.v0.1',
      taskLedger: { enabled: true }
    }, null, 2)}\n`, 'utf8');
    const missingRootRoute = await runNext(['--cwd', isolatedRoot, '--prompt', '請依照 3KLife docs/ai_atomic_framework 規劃完成 TASK-AAO-0043']);
    assert(missingRootRoute.ok === false, 'missing configured planning root must fail closed');
    assert(missingRootRoute.messages.some((entry) => entry.code === 'ATM_PLANNING_ROOT_MISSING'), 'missing configured planning root must emit ATM_PLANNING_ROOT_MISSING');
    assert((missingRootRoute.evidence.nextAction as any)?.planningRootMissing?.suggestedConfig?.taskLedger?.planningRoots, 'missing planning root diagnostic must suggest config action');
    rmSync(isolatedRoot, { recursive: true, force: true });

    const importedRelative = await runTasks([
      'import',
      '--cwd',
      tempRoot,
      '--from',
      path.join(externalTaskDir, 'TASK-AAO-0001-report-overlap-matrix-routing.task.md'),
      '--dry-run',
      '--json'
    ]);
    assert(importedRelative.ok === true, 'tasks import dry-run must succeed for external planning card');
    const importedPlanPath = (importedRelative.evidence as any)?.manifest?.tasks?.[0]?.source?.planPath ?? '';
    assert(!importedPlanPath.startsWith('../'), 'imported planning paths must be stored relative to planning root');
    assert(importedPlanPath.includes('atm-agent-first-operability/tasks/TASK-AAO-0001-report-overlap-matrix-routing.task.md'), 'imported planning path must stay planning-root-relative');

    writeTaskCard(path.join(taskDir, 'TASK-EMPTY-0001.task.md'), 'TASK-EMPTY-0001', 'Empty scope fixture', { status: 'done' });
    const emptyScope = await runNext(['--cwd', tempRoot, '--prompt', 'Please continue remaining TASK-EMPTY task cards one by one']);
    assert(emptyScope.ok === true, 'family prompt with only closed task cards must return a clean no-work result');
    assert(emptyScope.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_NO_WORK'), 'family prompt with only closed task cards must report no-work instead of scope-not-found');
    assert((emptyScope.evidence.nextAction as any).status === 'task-no-work', 'no-work route must expose task-no-work status');
    const emptyScopeTrail = assertDecisionTrail(emptyScope.evidence.nextAction as any, 'task-no-work');
    assert(emptyScopeTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'pass'), 'no-work route must record a passing prompt-scope-resolution decision');

    const shorthandExact = await runNext(['--cwd', tempRoot, '--prompt', '請補強 AAO-0011 unrelated untracked claim 行為']);
    assert(shorthandExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'AAO shorthand task id must route to canonical TASK-AAO card');
    assert((shorthandExact.evidence.nextAction as any).planningCardImport?.status === 'planning-card-not-in-target-ledger', 'AAO shorthand markdown route must surface import-required guidance before claim');
    assert(String((shorthandExact.evidence.nextAction as any).planningCardImport?.requiredCommand ?? '').includes('tasks import'), 'AAO shorthand markdown route must expose tasks import command');
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
  ctx.ledgerTaskDir = ledgerTaskDir;
  ctx.atomizationCoverageDir = atomizationCoverageDir;
}
