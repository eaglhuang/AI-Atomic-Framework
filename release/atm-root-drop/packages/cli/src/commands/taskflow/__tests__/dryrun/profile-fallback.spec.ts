import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../../next.ts';
import { runTaskflow } from '../../../taskflow.ts';
import { initGitRepo, writeJson, writeText } from './fixtures.ts';

async function makeProfileFallbackCloseFixture(label: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-profile-fallback-${label}-`));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: `target-profile-fallback-${label}`, type: 'module' });
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
  writeJson(path.join(targetRepo, '.atm/runtime/identity/default.json'), {
    actorId: 'validator',
    gitName: 'ATM Validator',
    gitEmail: 'validator@example.invalid',
    updatedAt: new Date().toISOString()
  });

  const fixtureTaskId = `TASK-FB-${label.toUpperCase()}`;
  const planPath = path.join(planningRepo, 'docs', 'tasks', `${fixtureTaskId}.task.md`);
  writeText(planPath, [
    '---',
    `task_id: ${fixtureTaskId}`,
    'title: "Profile fallback close fixture"',
    'status: running',
    '---',
    `# ${fixtureTaskId}`,
    ''
  ].join('\n'));
  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: `profile-fallback-${label}-profile`,
    name: 'Profile Fallback Close Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-FB',
    taskId: { format: 'TASK-FB-NNNN' },
    template: { defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}' },
    capabilities: { supportsDryRun: true, supportsWrite: false },
    delegation: {
      hint: 'Planning repo owns task cards and profile-root closeback fallback.',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: { mode: 'host-opener', prefix: 'TASK-FB', format: 'TASK-FB-NNNN' },
        resolveCanonicalOutputPath: {
          mode: 'host-opener',
          pattern: 'docs/tasks/${taskId}.task.md',
          directory: 'docs/tasks'
        },
        rosterSyncPolicy: 'none',
        fallbackBehavior: { mode: 'template-only-fallback', reason: 'fallback' }
      },
      writerInvocation: { describeOnly: false, displayHint: 'node tools/task-card-opener.js --write --task ${taskId}' }
    }
  });
  writeJson(path.join(targetRepo, '.atm/history/tasks', `${fixtureTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: fixtureTaskId,
    title: 'Profile fallback close fixture',
    status: 'ready',
    scopePaths: ['src/deliver.txt'],
    deliverables: ['src/deliver.txt'],
    planningRepo: 'planning',
    targetRepo: 'target',
    closureAuthority: 'target_repo'
  });
  execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base target fixture'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base planning fixture'], { cwd: planningRepo, stdio: 'ignore' });

  const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', fixtureTaskId]);
  assert.equal(claim.ok, true, 'profile fallback fixture must be claimable');
  writeText(path.join(targetRepo, 'src/deliver.txt'), 'delivered\n');
  execFileSync('git', ['add', 'src/deliver.txt'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'deliver fixture'], { cwd: targetRepo, stdio: 'ignore' });
  const deliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetRepo, encoding: 'utf8' }).trim();
  writeJson(path.join(targetRepo, '.atm/history/evidence', `${fixtureTaskId}.json`), {
    taskId: fixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'profile fallback fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['validate:cli'],
      artifactPaths: ['src/deliver.txt'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate profile fallback close fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  return {
    targetRepo,
    planningRepo,
    taskId: fixtureTaskId,
    planPath,
    deliveryCommit,
    profilePath: path.join(planningRepo, 'taskflow.profile.json')
  };
}

const profileFallbackFixture = await makeProfileFallbackCloseFixture('recover');
const profileFallbackDryRun = await runTaskflow([
  'close',
  '--cwd', profileFallbackFixture.targetRepo,
  '--profile', profileFallbackFixture.profilePath,
  '--task', profileFallbackFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', profileFallbackFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(profileFallbackDryRun.ok, true, 'profile-only fallback dry-run must succeed');
assert.equal(profileFallbackDryRun.evidence.closebackPathResolution.route, 'profile-root-fallback');
assert.equal(profileFallbackDryRun.evidence.closebackPlan.closebackPathResolution?.route, 'profile-root-fallback');
assert.ok(profileFallbackDryRun.evidence.governedCommitBundle.planningRepo.stageFiles.includes(`docs/tasks/${profileFallbackFixture.taskId}.task.md`));

const profileFallbackMissingFixture = await makeProfileFallbackCloseFixture('missing');
const profileFallbackMissingTaskPath = path.join(profileFallbackMissingFixture.targetRepo, '.atm/history/tasks', `${profileFallbackMissingFixture.taskId}.json`);
writeJson(profileFallbackMissingTaskPath, {
  ...JSON.parse(readFileSync(profileFallbackMissingTaskPath, 'utf8')),
  workItemId: profileFallbackMissingFixture.taskId
});
rmSync(profileFallbackMissingFixture.planPath);
await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', profileFallbackMissingFixture.targetRepo,
    '--profile', profileFallbackMissingFixture.profilePath,
    '--task', profileFallbackMissingFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', profileFallbackMissingFixture.deliveryCommit,
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'
);

const profileFallbackBrokenSourceFixture = await makeProfileFallbackCloseFixture('broken-source-plan');
const brokenSourceTaskPath = path.join(profileFallbackBrokenSourceFixture.targetRepo, '.atm/history/tasks', `${profileFallbackBrokenSourceFixture.taskId}.json`);
writeJson(brokenSourceTaskPath, {
  ...JSON.parse(readFileSync(brokenSourceTaskPath, 'utf8')),
  source: {
    planPath: 'missing/tasks/TASK-BROKEN.task.md',
    sectionTitle: profileFallbackBrokenSourceFixture.taskId,
    headingLine: 1,
    hash: 'broken-source-plan'
  }
});
const brokenSourceFallbackDryRun = await runTaskflow([
  'close',
  '--cwd', profileFallbackBrokenSourceFixture.targetRepo,
  '--profile', profileFallbackBrokenSourceFixture.profilePath,
  '--task', profileFallbackBrokenSourceFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', profileFallbackBrokenSourceFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(brokenSourceFallbackDryRun.ok, true, 'profile fallback must recover when source.planPath is stale');
assert.equal(brokenSourceFallbackDryRun.evidence.closebackPathResolution.route, 'profile-root-fallback');
assert.equal(brokenSourceFallbackDryRun.evidence.closebackPlan.closebackPathResolution?.route, 'profile-root-fallback');

const taskDirectionFallbackFixture = await makeProfileFallbackCloseFixture('task-direction-fallback');
const taskDirectionFallbackTaskPath = path.join(taskDirectionFallbackFixture.targetRepo, '.atm/history/tasks', `${taskDirectionFallbackFixture.taskId}.json`);
writeJson(taskDirectionFallbackTaskPath, {
  ...JSON.parse(readFileSync(taskDirectionFallbackTaskPath, 'utf8')),
  source: {
    planPath: 'missing/tasks/TASK-BROKEN.task.md',
    sectionTitle: taskDirectionFallbackFixture.taskId,
    headingLine: 1,
    hash: 'broken-source-plan'
  },
  taskDirectionLock: {
    planningReadOnlyPaths: [taskDirectionFallbackFixture.planPath],
    planningMirrorPaths: [taskDirectionFallbackFixture.planPath]
  }
});
const taskDirectionFallbackDryRun = await runTaskflow([
  'close',
  '--cwd', taskDirectionFallbackFixture.targetRepo,
  '--task', taskDirectionFallbackFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', taskDirectionFallbackFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(taskDirectionFallbackDryRun.ok, true, 'task-direction fallback must recover when source.planPath is stale without a profile');
assert.equal(taskDirectionFallbackDryRun.evidence.closebackPathResolution.route, 'task-direction-fallback');
assert.equal(taskDirectionFallbackDryRun.evidence.closebackPlan.closebackPathResolution?.route, 'task-direction-fallback');

const externalStoredPathFixture = await makeProfileFallbackCloseFixture('external-stored-path');
writeJson(path.join(externalStoredPathFixture.targetRepo, '.atm/config.json'), {
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
    provider: 'atm-local',
    planningRoots: ['../planning/docs/ai_atomic_framework']
  }
});
const externalStoredPlanPath = path.join(
  externalStoredPathFixture.planningRepo,
  'docs',
  'ai_atomic_framework',
  'atm-agent-first-operability',
  'tasks',
  `${externalStoredPathFixture.taskId}.task.md`
);
mkdirSync(path.dirname(externalStoredPlanPath), { recursive: true });
writeText(externalStoredPlanPath, [
  '---',
  `task_id: ${externalStoredPathFixture.taskId}`,
  'title: "External stored path close fixture"',
  'status: running',
  '---',
  `# ${externalStoredPathFixture.taskId}`,
  ''
].join('\n'));
const externalStoredTaskPath = path.join(externalStoredPathFixture.targetRepo, '.atm/history/tasks', `${externalStoredPathFixture.taskId}.json`);
writeJson(externalStoredTaskPath, {
  ...JSON.parse(readFileSync(externalStoredTaskPath, 'utf8')),
  source: {
    planPath: `atm-agent-first-operability/tasks/${externalStoredPathFixture.taskId}.task.md`,
    sectionTitle: externalStoredPathFixture.taskId,
    headingLine: 1,
    hash: 'external-stored-path'
  },
  claim: {
    actorId: 'validator',
    leaseId: 'lease-external-stored',
    state: 'active',
    files: [
      `atm-agent-first-operability/tasks/${externalStoredPathFixture.taskId}.task.md`,
      'src/deliver.txt'
    ]
  },
  taskDirectionLock: {
    allowedFiles: ['src/deliver.txt'],
    planningReadOnlyPaths: [`atm-agent-first-operability/tasks/${externalStoredPathFixture.taskId}.task.md`],
    planningMirrorPaths: [`atm-agent-first-operability/tasks/${externalStoredPathFixture.taskId}.task.md`]
  }
});
const externalStoredPathDryRun = await runTaskflow([
  'close',
  '--cwd', externalStoredPathFixture.targetRepo,
  '--task', externalStoredPathFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', externalStoredPathFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(externalStoredPathDryRun.ok, true, 'stored external planning paths must resolve without profile fallback');
assert.equal(externalStoredPathDryRun.evidence.closebackPathResolution.route, 'source-plan-path');
assert.equal(externalStoredPathDryRun.evidence.closebackPlan.closebackPathResolution?.route, 'source-plan-path');
assert.ok(externalStoredPathDryRun.evidence.governedCommitBundle.planningRepo.stageFiles.includes(
  `docs/ai_atomic_framework/atm-agent-first-operability/tasks/${externalStoredPathFixture.taskId}.task.md`
));

const profileFallbackAmbiguousFixture = await makeProfileFallbackCloseFixture('ambiguous');
const ambiguousTaskPath = path.join(profileFallbackAmbiguousFixture.targetRepo, '.atm/history/tasks', `${profileFallbackAmbiguousFixture.taskId}.json`);
writeJson(ambiguousTaskPath, {
  ...JSON.parse(readFileSync(ambiguousTaskPath, 'utf8')),
  related_plan: path.join(profileFallbackAmbiguousFixture.planningRepo, 'docs/tasks/OTHER.task.md')
});
writeText(path.join(profileFallbackAmbiguousFixture.planningRepo, 'docs/tasks/OTHER.task.md'), [
  '---',
  `task_id: ${profileFallbackAmbiguousFixture.taskId}`,
  'title: "Conflicting related plan"',
  'status: running',
  '---',
  `# ${profileFallbackAmbiguousFixture.taskId}`,
  ''
].join('\n'));
await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', profileFallbackAmbiguousFixture.targetRepo,
    '--profile', profileFallbackAmbiguousFixture.profilePath,
    '--task', profileFallbackAmbiguousFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', profileFallbackAmbiguousFixture.deliveryCommit,
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_AMBIGUOUS'
);

console.log('[taskflow-dryrun:profile-fallback] ok');
