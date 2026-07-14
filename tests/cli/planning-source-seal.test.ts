import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';
import { runTasksClaimLifecycle } from '../../packages/cli/src/commands/tasks/claim-orchestrator.ts';
import { validatePlanningSourceSeal } from '../../packages/cli/src/commands/tasks/import-task.ts';
import { resolveClosebackPlanningPath } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';
import { buildDelegationContract } from '../../packages/cli/src/commands/taskflow/profile-loader.ts';
import { toStoredPlanningPath } from '../../packages/cli/src/commands/planning-repo-root.ts';

function writeText(filePath: string, text: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath: string, value: unknown) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function initGitRepo(repo: string) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}

function commitAll(repo: string, message: string) {
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', message], { cwd: repo, stdio: 'ignore' });
}

function writeTaskCard(filePath: string, input: {
  taskId: string;
  title: string;
  amendmentEpoch: number;
  extraAcceptance?: string;
}) {
  writeText(filePath, [
    '---',
    `task_id: ${input.taskId}`,
    `title: "${input.title}"`,
    'status: planned',
    'target_repo: AI-Atomic-Framework',
    'planning_repo: 3KLife',
    'closure_authority: target_repo',
    `amendment_epoch: ${input.amendmentEpoch}`,
    'scopePaths:',
    '  - "src/example.ts"',
    'deliverables:',
    '  - "src/example.ts"',
    'validators:',
    '  - "npm run typecheck"',
    '---',
    '',
    `# ${input.taskId} - ${input.title}`,
    '',
    '## Acceptance',
    '',
    '- Import records a planning-source seal.',
    input.extraAcceptance ? `- ${input.extraAcceptance}` : ''
  ].filter((line) => line !== '').join('\n'));
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-source-seal-'));
const targetRepo = path.join(tempRoot, 'target');
const planningRepo = path.join(tempRoot, 'planning');
initGitRepo(targetRepo);
initGitRepo(planningRepo);
writeJson(path.join(targetRepo, 'package.json'), { name: 'planning-source-target', type: 'module' });
writeJson(path.join(targetRepo, '.atm/config.json'), {
  schemaVersion: 'atm.config.v0.1',
  layoutVersion: 2,
  paths: {
    tasks: '.atm/history/tasks',
    taskEvents: '.atm/history/task-events'
  },
  taskLedger: {
    enabled: true,
    mode: 'auto',
    mirrorExternalTasks: true,
    requireCliTransitions: true,
    provider: 'atm-local'
  }
});
commitAll(targetRepo, 'base target');

const taskId = 'TASK-SEAL-0001';
const cardPath = path.join(planningRepo, 'docs/tasks/TASK-SEAL-0001.task.md');
writeTaskCard(cardPath, {
  taskId,
  title: 'Planning source seal fixture',
  amendmentEpoch: 0
});
commitAll(planningRepo, 'base planning card');

const importResult = await runTasksImport([
  '--cwd', targetRepo,
  '--from', cardPath,
  '--write',
  '--json'
]) as any;
assert.equal(importResult.ok, true);

const taskPath = path.join(targetRepo, '.atm/history/tasks/TASK-SEAL-0001.json');
const importedTask = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
const source = importedTask.source as Record<string, unknown>;
assert.equal((source.planningSourceSeal as any).schemaId, 'atm.planningSourceSeal.v1');
assert.equal((source.planningSourceSeal as any).taskCardPath, toStoredPlanningPath(targetRepo, cardPath));
assert.equal(typeof (source.planningSourceSeal as any).planningCommitSha, 'string');
assert.equal((source.planningSourceSeal as any).amendmentEpoch, 0);
assert.ok(Array.isArray(importedTask.planningReadOnlyPaths), 'import must preserve planningReadOnlyPaths even when empty');

const cleanValidation = validatePlanningSourceSeal({ cwd: targetRepo, taskDocument: importedTask });
assert.equal(cleanValidation.ok, true);
assert.equal(cleanValidation.status, 'match');

writeTaskCard(cardPath, {
  taskId,
  title: 'Planning source seal fixture',
  amendmentEpoch: 0,
  extraAcceptance: 'Ungoverned drift should be rejected.'
});
commitAll(planningRepo, 'ungoverned card drift');

await assert.rejects(
  () => runTasksClaimLifecycle('claim', [
    '--cwd', targetRepo,
    '--task', taskId,
    '--actor', 'validator',
    '--json'
  ]),
  (err: any) => {
    assert.equal(err.code, 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT');
    assert.ok(err.details.driftKinds.includes('content'));
    assert.ok(err.details.driftKinds.includes('commit'));
    return true;
  }
);

const profile = {
  schemaId: 'taskflow.profile.v1' as const,
  id: 'planning-source-seal-profile',
  name: 'Planning Source Seal Profile',
  repoLabel: 'Planning Repo',
  ownerRepo: 'planning',
  taskIdPrefix: 'TASK-SEAL',
  taskId: { format: 'TASK-SEAL-NNNN' },
  template: { defaultMarkdown: '# ${taskId} ${title}' },
  capabilities: { supportsDryRun: true, supportsWrite: false },
  delegation: {
    hint: 'Planning repo owns cards.',
    policy: {
      allocateTaskId: { mode: 'fallback' as const, prefix: 'TASK-SEAL', format: 'TASK-SEAL-NNNN' },
      resolveCanonicalOutputPath: { mode: 'fallback' as const, pattern: 'docs/tasks/${taskId}.task.md', directory: 'docs/tasks' },
      rosterSyncPolicy: 'none' as const,
      fallbackBehavior: { mode: 'template-only-fallback' as const, reason: 'test' }
    }
  }
};
assert.throws(
  () => resolveClosebackPlanningPath({
    cwd: targetRepo,
    taskId,
    taskDocument: importedTask,
    profile,
    profileRepoRoot: planningRepo,
    delegationContract: buildDelegationContract(profile)
  }),
  (err: any) => err.code === 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT'
);

writeTaskCard(cardPath, {
  taskId,
  title: 'Planning source seal fixture',
  amendmentEpoch: 1,
  extraAcceptance: 'Governed amendment may advance the card.'
});
commitAll(planningRepo, 'governed amendment');
const amendedValidation = validatePlanningSourceSeal({ cwd: targetRepo, taskDocument: importedTask });
assert.equal(amendedValidation.ok, true);
assert.equal(amendedValidation.status, 'governed-amendment');
assert.ok(amendedValidation.driftKinds.includes('amendment-epoch'));

console.log('[planning-source-seal:test] ok');
