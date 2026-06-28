import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldSkipExternalTaskCardScan, shouldSkipMarkdownTaskDiscovery } from '../../packages/cli/src/commands/next.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const jsonTasks = [
  {
    workItemId: 'TASK-SKL-0002',
    title: 'Tool bridge execution',
    status: 'planned',
    closedAt: null,
    closedByActor: null,
    closurePacket: null,
    lastTransitionId: null,
    lastTransitionAt: null,
    milestone: 'P1',
    dependencies: ['TASK-SKL-0001'],
    taskPath: '.atm/history/tasks/TASK-SKL-0002.json',
    format: 'json',
    sourcePlanPath: 'docs/ai_atomic_framework/skl-tool-first-upgrade/tasks/TASK-SKL-0002-tool-bridge-v1-schema-and-result-adapter.task.md',
    nearbyPlanPaths: ['docs/ai_atomic_framework/skl-tool-first-upgrade/SKL-tool-first-upgrade-plan.md'],
    scopePaths: ['packages/cli/src/commands/shared.ts'],
    targetRepo: 'AI-Atomic-Framework',
    planningRepo: '3KLife',
    allowPlanningMirror: false,
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    targetAllowedFiles: ['packages/cli/src/commands/shared.ts'],
    closureAuthority: 'target_repo',
    activeClaimActorId: null,
    activeClaimIntent: null,
    matchScore: 90,
    matchReasons: ['task-root-hint-match', 'nearby-plan-name-match']
  },
  {
    workItemId: 'TASK-SKL-0003',
    title: 'Next and claim tools',
    status: 'planned',
    closedAt: null,
    closedByActor: null,
    closurePacket: null,
    lastTransitionId: null,
    lastTransitionAt: null,
    milestone: 'P1',
    dependencies: ['TASK-SKL-0002'],
    taskPath: '.atm/history/tasks/TASK-SKL-0003.json',
    format: 'json',
    sourcePlanPath: 'docs/ai_atomic_framework/skl-tool-first-upgrade/tasks/TASK-SKL-0003-next-claim-framework-mode-tools.task.md',
    nearbyPlanPaths: ['docs/ai_atomic_framework/skl-tool-first-upgrade/SKL-tool-first-upgrade-plan.md'],
    scopePaths: ['packages/cli/src/commands/next.ts'],
    targetRepo: 'AI-Atomic-Framework',
    planningRepo: '3KLife',
    allowPlanningMirror: false,
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    targetAllowedFiles: ['packages/cli/src/commands/next.ts'],
    closureAuthority: 'target_repo',
    activeClaimActorId: null,
    activeClaimIntent: null,
    matchScore: 90,
    matchReasons: ['task-root-hint-match', 'nearby-plan-name-match']
  }
];

const queueIntent = {
  schemaId: 'atm.taskIntent.v1',
  userPrompt: '請實作完成所有 SKL 系列的全部任務卡',
  explicitTaskIds: [],
  mentionedTaskIds: [],
  mentionedPlanPaths: [],
  taskRootHints: ['SKL', 'skl-tool-first-upgrade'],
  targetRepoHints: [],
  requestedAction: 'implement',
  confidence: 0.9,
  source: 'cli-deterministic',
  ordinalScope: null,
  queueRequested: true,
  taskScopeMentioned: true
} as const;

const explicitPlanIntent = {
  ...queueIntent,
  mentionedPlanPaths: ['docs/ai_atomic_framework/skl-tool-first-upgrade/SKL-tool-first-upgrade-plan.md']
};

assert.equal(
  shouldSkipExternalTaskCardScan(root, jsonTasks as any, queueIntent as any),
  true,
  'queue-scoped imported JSON tasks should bypass external task-card scans when the ledger already resolves the route'
);

assert.equal(
  shouldSkipMarkdownTaskDiscovery(root, jsonTasks as any, queueIntent as any),
  true,
  'queue-scoped imported JSON tasks should bypass local markdown task discovery when the ledger already resolves the route'
);

assert.equal(
  shouldSkipExternalTaskCardScan(root, jsonTasks as any, explicitPlanIntent as any),
  false,
  'explicit plan-path prompts must still allow external task-card discovery'
);

assert.equal(
  shouldSkipMarkdownTaskDiscovery(root, jsonTasks as any, explicitPlanIntent as any),
  false,
  'explicit plan-path prompts must still allow markdown task discovery'
);

console.log('[next-external-scan-guard:test] ok');
