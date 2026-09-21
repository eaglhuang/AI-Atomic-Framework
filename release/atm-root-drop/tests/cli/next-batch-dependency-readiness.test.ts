import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPromptScopeQueueResult } from '../../packages/cli/src/commands/next/prompt-result-contracts.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-next-batch-dependency-'));

try {
  const queueHeadTask = {
    workItemId: 'TASK-QUEUE-HEAD',
    title: 'Queue head that depends on missing upstream code capability',
    status: 'planned',
    closedAt: null,
    closedByActor: null,
    closurePacket: null,
    lastTransitionId: null,
    lastTransitionAt: null,
    milestone: null,
    dependencies: ['TASK-MISSING-UPSTREAM'],
    taskPath: '.atm/history/tasks/TASK-QUEUE-HEAD.json',
    format: 'json',
    sourcePlanPath: 'tasks/TASK-QUEUE-HEAD.task.md',
    nearbyPlanPaths: [],
    scopePaths: ['packages/cli/src/commands/next/prompt-result-contracts.ts'],
    outOfScope: [],
    targetRepo: 'test-repo',
    planningRepo: 'planning-repo',
    allowPlanningMirror: false,
    closureAuthority: 'target_repo',
    activeClaimActorId: null,
    activeClaimLaneSessionId: null,
    activeClaimIntent: null,
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    targetAllowedFiles: ['packages/cli/src/commands/next/prompt-result-contracts.ts']
  };

  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-QUEUE-HEAD.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-QUEUE-HEAD',
    status: 'planned',
    dependencies: ['TASK-MISSING-UPSTREAM']
  });

  const result = buildPromptScopeQueueResult({
    cwd: repo,
    actor: 'tester',
    taskIntent: {
      schemaId: 'atm.taskIntent.v1',
      userPrompt: 'continue the batch',
      explicitTaskIds: [],
      mentionedTaskIds: [],
      mentionedPlanPaths: [],
      taskRootHints: ['TASK'],
      targetRepoHints: [],
      requestedAction: null,
      confidence: 0.7,
      source: 'test',
      ordinalScope: null,
      queueRequested: true,
      taskScopeMentioned: true
    },
    importedTaskQueue: {
      taskStorePath: '.atm/history/tasks',
      openTaskCount: 1,
      selectedTask: queueHeadTask,
      claimableTask: queueHeadTask,
      tasks: [queueHeadTask],
      promptScope: {
        status: 'queue',
        selectedTasks: [queueHeadTask],
        targetRepo: 'test-repo',
        diagnostics: []
      },
      planningRootWarnings: [],
      planningRootMissing: null
    },
    selectedTasks: [queueHeadTask],
    queueHeadTask,
    integrationBootstrap: {
      repoBootstrapped: false,
      currentEditorId: null,
      currentEditorDetectedFrom: null,
      currentEditorRawValue: null,
      editorIdentityIsProvenanceOnly: true,
      actorAuthorityNote: 'test',
      currentEditorAdapter: null,
      currentEditorAdapterMissing: false,
      needsInstallHint: false,
      reason: null,
      installedAdapters: [],
      missingAdapters: [],
      adapters: [],
      suggestedAction: null
    },
    runtimeAdapterReadiness: { needsRuntimeAdapterHint: false }
  });
  const nextAction = result.evidence.nextAction as Record<string, unknown>;
  const lastMessage = result.messages.at(-1) as { code?: string; data?: Record<string, unknown> } | undefined;

  assert.equal(result.ok, false);
  assert.equal(nextAction.status, 'task-queue-head-claim-blocked');
  assert.equal(lastMessage?.code, 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED');
  assert.deepEqual(lastMessage?.data?.blockingTaskIds, ['TASK-MISSING-UPSTREAM']);
  assert.match(String(nextAction.requiredCommand), /tasks status --task TASK-MISSING-UPSTREAM/);
  assert.equal(
    nextAction.batchInstruction,
    'This batch queue head is not claimable. Do not edit, checkpoint, or advance the batch until the named blocker is resolved.'
  );
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[next-batch-dependency-readiness] ok');
