import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNext } from '../../next.ts';
import { runTaskflow } from '../../taskflow.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../../');

const res1 = await runTaskflow(['open', '--dry-run']) as any;
assert.equal(res1.ok, true);
assert.equal(res1.mode, 'dry-run');
assert.equal(res1.schemaId, 'atm.taskflowOpenResult.v1');
assert.equal(res1.writeEnabled, false);
assert.equal(res1.evidence.openerMode, 'template-only-fallback');
assert.equal(res1.evidence.delegationContract.hostOpenerAvailable, false);
assert.equal(res1.evidence.delegationContract.generationSurface, 'tasks-new');
assert.equal(res1.evidence.orchestrationPlan.wouldInvokeTasksNew, true);
assert.ok(res1.evidence.diagnostics.codes.includes('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK'));

const validProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const res2 = await runTaskflow(['open', '--dry-run', '--profile', validProfilePath]) as any;
assert.equal(res2.ok, true);
assert.equal(res2.mode, 'dry-run');
assert.equal(res2.evidence.profile.schemaId, 'taskflow.profile.v1');
assert.equal(res2.evidence.profile.id, 'adopter-profile-v1');
assert.equal(res2.evidence.openerMode, 'template-only-fallback');
assert.equal(res2.evidence.delegationContract.hostOpenerAvailable, true);
assert.equal(res2.evidence.delegationContract.describeOnly, true);
assert.equal(res2.evidence.delegationContract.openerPath, 'tools/task-card-opener.js');
assert.equal(res2.evidence.delegationContract.policy.allocateTaskId.mode, 'fallback');
assert.equal(res2.evidence.delegationContract.policy.rosterSyncPolicy, 'follow-up-command');
assert.equal(res2.evidence.orchestrationPlan.generationSurface, 'tasks-new');
assert.ok(res2.evidence.diagnostics.messages.some((entry: string) => entry.includes('describe-only')));

const governedProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/governed-invocable.profile.json');
const res3 = await runTaskflow(['open', '--dry-run', '--profile', governedProfilePath]) as any;
assert.equal(res3.evidence.openerMode, 'delegated-governed');
assert.equal(res3.evidence.delegationContract.invocable, true);
assert.equal(res3.evidence.writeSupport.allowed, false);
assert.equal(res3.evidence.hostPolicyDecision.taskId, 'TASK-GOVERNED-0001');
assert.equal(res3.evidence.hostPolicyDecision.outputPath, 'docs/tasks/TASK-GOVERNED-0001.task.md');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.allocateTaskId.mode, 'host-opener');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.resolveCanonicalOutputPath.mode, 'host-opener');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.rosterSyncPolicy, 'follow-up-command');
assert.equal(res3.evidence.fallbackBehavior.mode, 'template-only-fallback');

async function makeDualRepoOpenFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-taskflow-open-'));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: 'target-open-fixture', type: 'module' });
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
  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: 'dual-repo-open-profile',
    name: 'Dual Repo Open Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-OPEN',
    taskId: {
      format: 'TASK-OPEN-NNNN'
    },
    template: {
      defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}'
    },
    capabilities: {
      supportsDryRun: true,
      supportsWrite: false
    },
    delegation: {
      hint: 'Planning repo owns task cards; target repo owns runtime import.',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: {
          mode: 'host-opener',
          prefix: 'TASK-OPEN',
          format: 'TASK-OPEN-NNNN'
        },
        resolveCanonicalOutputPath: {
          mode: 'host-opener',
          pattern: 'docs/tasks/${taskId}.task.md',
          directory: 'docs/tasks'
        },
        rosterSyncPolicy: 'none',
        fallbackBehavior: {
          mode: 'template-only-fallback',
          reason: 'fallback'
        }
      },
      writerInvocation: {
        describeOnly: false,
        displayHint: 'node tools/task-card-opener.js --write --task ${taskId}'
      }
    }
  });
  execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base target open fixture'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base planning open fixture'], { cwd: planningRepo, stdio: 'ignore' });
  return { targetRepo, planningRepo, profilePath: path.join(planningRepo, 'taskflow.profile.json') };
}

const openFixture = await makeDualRepoOpenFixture();
const openWrite = await runTaskflow([
  'open',
  '--cwd', openFixture.targetRepo,
  '--profile', openFixture.profilePath,
  '--write',
  '--title', 'Dual repo open write fixture',
  '--json'
]) as any;
assert.equal(openWrite.ok, true);
assert.equal(openWrite.writeEnabled, true);
assert.equal(openWrite.evidence.openerMode, 'delegated-governed');
assert.equal(openWrite.evidence.hostPolicyDecision.taskId, 'TASK-OPEN-0001');
assert.equal(openWrite.evidence.hostPolicyDecision.outputPath, 'docs/tasks/TASK-OPEN-0001.task.md');
assert.ok(openWrite.evidence.runtimeImport, 'taskflow open write must import into target runtime');
assert.ok(
  readFileSync(path.join(openFixture.planningRepo, 'docs/tasks/TASK-OPEN-0001.task.md'), 'utf8').includes('TASK-OPEN-0001'),
  'taskflow open write must create the planning repo task card'
);
assert.ok(
  readFileSync(path.join(openFixture.targetRepo, '.atm/history/tasks/TASK-OPEN-0001.json'), 'utf8').includes('TASK-OPEN-0001'),
  'taskflow open write must import the task into the target runtime ledger'
);

await assert.rejects(
  () => runTaskflow(['open', '--write']),
  (err: any) => err.code === 'ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK'
);

const invalidProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
await assert.rejects(
  () => runTaskflow(['open', '--dry-run', '--profile', invalidProfilePath]),
  (err: any) => err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID'
);

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

async function makeDualRepoCloseFixture(label: string, options: { closePlanningStatus?: string } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-close-${label}-`));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: `target-${label}`, type: 'module' });
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

  const fixtureTaskId = `TASK-DUAL-${label.toUpperCase()}`;
  const planPath = path.join(planningRepo, 'docs', 'tasks', `${fixtureTaskId}.task.md`);
  const rosterPath = path.join(planningRepo, 'docs', 'tasks', 'README.md');
  writeText(planPath, [
    '---',
    `task_id: ${fixtureTaskId}`,
    'title: "Dual repo close fixture"',
    'status: running',
    '---',
    `# ${fixtureTaskId}`,
    ''
  ].join('\n'));
  writeText(rosterPath, [
    '| Task ID | Title | Status |',
    '| --- | --- | --- |',
    `| [${fixtureTaskId}](./${fixtureTaskId}.task.md) | Dual repo close fixture | running |`,
    ''
  ].join('\n'));
  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: `dual-repo-close-${label}-profile`,
    name: 'Dual Repo Close Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-DUAL',
    taskId: {
      format: 'TASK-DUAL-NNNN'
    },
    template: {
      defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}'
    },
    capabilities: {
      supportsDryRun: true,
      supportsWrite: false
    },
    delegation: {
      hint: 'Planning repo owns task cards and roster closeback.',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: {
          mode: 'host-opener',
          prefix: 'TASK-DUAL',
          format: 'TASK-DUAL-NNNN'
        },
        resolveCanonicalOutputPath: {
          mode: 'host-opener',
          pattern: 'docs/tasks/${taskId}.task.md',
          directory: 'docs/tasks'
        },
        rosterSyncPolicy: 'inline',
        rosterSync: {
          indexPath: 'docs/tasks/README.md'
        },
        fallbackBehavior: {
          mode: 'template-only-fallback',
          reason: 'fallback'
        }
      },
      writerInvocation: {
        describeOnly: false,
        displayHint: 'node tools/task-card-opener.js --write --task ${taskId}'
      }
    }
  });
  writeJson(path.join(targetRepo, '.atm/history/tasks', `${fixtureTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: fixtureTaskId,
    title: 'Dual repo close fixture',
    status: 'ready',
    scopePaths: ['src/deliver.txt'],
    deliverables: ['src/deliver.txt'],
    planningRepo: 'planning',
    targetRepo: 'target',
    closureAuthority: 'target_repo',
    source: {
      planPath,
      sectionTitle: fixtureTaskId,
      headingLine: 1,
      hash: 'dual-repo-close-fixture'
    }
  });
  execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base target fixture'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base planning fixture'], { cwd: planningRepo, stdio: 'ignore' });

  const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', fixtureTaskId]);
  assert.equal(claim.ok, true, 'dual repo fixture must be claimable');
  writeText(path.join(targetRepo, 'src/deliver.txt'), 'delivered\n');
  execFileSync('git', ['add', 'src/deliver.txt'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'deliver fixture'], { cwd: targetRepo, stdio: 'ignore' });
  const deliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetRepo, encoding: 'utf8' }).trim();
  writeJson(path.join(targetRepo, '.atm/history/evidence', `${fixtureTaskId}.json`), {
    taskId: fixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'dual repo fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['validate:cli'],
      artifactPaths: ['src/deliver.txt'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate dual repo taskflow close fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  writeText(planPath, [
    '---',
    `task_id: ${fixtureTaskId}`,
    'title: "Dual repo close fixture"',
    `status: ${options.closePlanningStatus ?? 'done'}`,
    '---',
    `# ${fixtureTaskId}`,
    ''
  ].join('\n'));
  writeText(path.join(targetRepo, 'scratch.txt'), 'unrelated noise\n');
  return { targetRepo, planningRepo, taskId: fixtureTaskId, planPath, deliveryCommit, profilePath: path.join(planningRepo, 'taskflow.profile.json') };
}

const dryRunFixture = await makeDualRepoCloseFixture('dryrun');
const dryRunClose = await runTaskflow([
  'close',
  '--cwd', dryRunFixture.targetRepo,
  '--task', dryRunFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', dryRunFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(dryRunClose.ok, true);
assert.equal(dryRunClose.evidence.governedCommitBundle.schemaId, 'atm.taskflowGovernedCommitBundle.v1');
assert.equal(dryRunClose.evidence.governedCommitBundle.commitMode, 'dry-run');
assert.equal(dryRunClose.evidence.governedCommitBundle.targetRepo.status, 'preview');
assert.equal(dryRunClose.evidence.governedCommitBundle.planningRepo.status, 'preview');
assert.ok(dryRunClose.evidence.governedCommitBundle.targetRepo.stageFiles.includes(`.atm/history/tasks/${dryRunFixture.taskId}.json`));
assert.ok(dryRunClose.evidence.governedCommitBundle.planningRepo.stageFiles.includes(`docs/tasks/${dryRunFixture.taskId}.task.md`));
assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dryRunFixture.targetRepo, encoding: 'utf8' }).trim(), '', 'dry-run must not stage target repo');
assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dryRunFixture.planningRepo, encoding: 'utf8' }).trim(), '', 'dry-run must not stage planning repo');

const normalLaneFixture = await makeDualRepoCloseFixture('normal-lane-planned', { closePlanningStatus: 'planned' });
const normalLaneDryRun = await runTaskflow([
  'close',
  '--cwd', normalLaneFixture.targetRepo,
  '--profile', normalLaneFixture.profilePath,
  '--task', normalLaneFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', normalLaneFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(normalLaneDryRun.ok, true);
assert.equal(normalLaneDryRun.evidence.closeMode, 'normal-close', 'active target ledger plus open planning card must stay on the normal close lane');
assert.equal(normalLaneDryRun.evidence.closebackPlan.backendSurface, 'tasks-close', 'normal close lane must route to tasks-close backend');
const normalLaneStage = await runTaskflow([
  'close',
  '--cwd', normalLaneFixture.targetRepo,
  '--profile', normalLaneFixture.profilePath,
  '--task', normalLaneFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', normalLaneFixture.deliveryCommit,
  '--write',
  '--no-commit',
  '--json'
]) as any;
assert.equal(normalLaneStage.evidence.closeMode, 'normal-close');
assert.equal(normalLaneStage.evidence.planningCardCloseback?.mode, 'frontmatter-closeback', 'taskflow close must update the planning card in the same closeback story');
const normalLanePlanningCard = readFileSync(normalLaneFixture.planPath, 'utf8');
assert.ok(normalLanePlanningCard.includes('status: done'), 'taskflow close must mark the planning card done');
assert.ok(normalLanePlanningCard.includes('completed_by_agent: "validator"'), 'taskflow close must record the planning closeback actor');
assert.ok(normalLanePlanningCard.includes(`delivery_commit: "${normalLaneFixture.deliveryCommit}"`), 'taskflow close must record the delivery commit on the planning card');
assert.deepEqual(
  execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: normalLaneFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
  ['docs/tasks/README.md', `docs/tasks/${normalLaneFixture.taskId}.task.md`],
  'normal close lane must exact-stage only the planning closeback bundle'
);

const stageOnlyFixture = await makeDualRepoCloseFixture('stageonly');
const stageOnlyTargetHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim();
const stageOnlyPlanningHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim();
const stageOnly = await runTaskflow([
  'close',
  '--cwd', stageOnlyFixture.targetRepo,
  '--profile', stageOnlyFixture.profilePath,
  '--task', stageOnlyFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', stageOnlyFixture.deliveryCommit,
  '--write',
  '--no-commit',
  '--json'
]) as any;
assert.equal(stageOnly.evidence.governedCommitBundle.commitMode, 'stage-only');
assert.equal(stageOnly.evidence.governedCommitBundle.targetRepo.status, 'staged');
assert.equal(stageOnly.evidence.governedCommitBundle.planningRepo.status, 'staged');
assert.equal(stageOnly.evidence.governedCommitBundle.failClosed, false);
assert.equal(stageOnly.evidence.governedCommitBundle.targetRepo.indexIsolation.verified, true, 'stage-only target index isolation must be verified');
assert.equal(stageOnly.evidence.governedCommitBundle.planningRepo.indexIsolation.verified, true, 'stage-only planning index isolation must be verified');
assert.ok(stageOnly.evidence.governedCommitBundle.targetRepo.indexIsolation.expectedStageFiles.includes(`.atm/history/evidence/${stageOnlyFixture.taskId}.json`), 'target index diagnostics must include expected bundle files');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim(), stageOnlyTargetHead, '--no-commit must not commit target repo');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim(), stageOnlyPlanningHead, '--no-commit must not commit planning repo');
const stageOnlyTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const stageOnlyPlanningStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(stageOnlyTargetStaged.includes(`.atm/history/tasks/${stageOnlyFixture.taskId}.json`), 'stage-only target bundle must stage task json');
assert.ok(stageOnlyTargetStaged.some((entry) => entry.startsWith(`.atm/history/task-events/${stageOnlyFixture.taskId}/`) && entry.includes('-close-')), 'stage-only target bundle must stage close event');
assert.ok(!stageOnlyTargetStaged.includes('scratch.txt'), 'stage-only target bundle must not stage unrelated dirty files');
assert.deepEqual(stageOnlyPlanningStaged, ['docs/tasks/README.md', `docs/tasks/${stageOnlyFixture.taskId}.task.md`], 'stage-only planning bundle must exact-stage the planning card and roster');
assert.ok(
  readFileSync(path.join(stageOnlyFixture.planningRepo, 'docs/tasks/README.md'), 'utf8').includes('| done |'),
  'profile-only taskflow close must update the planning roster from the planning repo'
);

const targetIndexContaminationFixture = await makeDualRepoCloseFixture('target-index-contamination');
writeText(path.join(targetIndexContaminationFixture.targetRepo, 'pre-staged-target.txt'), 'must not commit\n');
execFileSync('git', ['add', 'pre-staged-target.txt'], { cwd: targetIndexContaminationFixture.targetRepo, stdio: 'ignore' });
await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', targetIndexContaminationFixture.targetRepo,
    '--profile', targetIndexContaminationFixture.profilePath,
    '--task', targetIndexContaminationFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', targetIndexContaminationFixture.deliveryCommit,
    '--write',
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_INDEX_NOT_ISOLATED' && err.details?.indexIsolation?.unexpectedStagedFiles?.includes('pre-staged-target.txt'),
  'target repo unrelated pre-staged files must fail closed before auto-commit'
);

const planningIndexContaminationFixture = await makeDualRepoCloseFixture('planning-index-contamination');
writeText(path.join(planningIndexContaminationFixture.planningRepo, 'docs/tasks/pre-staged-planning.md'), 'must not commit\n');
execFileSync('git', ['add', 'docs/tasks/pre-staged-planning.md'], { cwd: planningIndexContaminationFixture.planningRepo, stdio: 'ignore' });
await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', planningIndexContaminationFixture.targetRepo,
    '--profile', planningIndexContaminationFixture.profilePath,
    '--task', planningIndexContaminationFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', planningIndexContaminationFixture.deliveryCommit,
    '--write',
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_INDEX_NOT_ISOLATED' && err.details?.indexIsolation?.unexpectedStagedFiles?.includes('docs/tasks/pre-staged-planning.md'),
  'planning repo unrelated pre-staged files must fail closed before auto-commit'
);

const expectedPreStagedFixture = await makeDualRepoCloseFixture('expected-pre-staged');
execFileSync('git', ['add', `.atm/history/evidence/${expectedPreStagedFixture.taskId}.json`], { cwd: expectedPreStagedFixture.targetRepo, stdio: 'ignore' });
execFileSync('git', ['add', `docs/tasks/${expectedPreStagedFixture.taskId}.task.md`], { cwd: expectedPreStagedFixture.planningRepo, stdio: 'ignore' });
const expectedPreStaged = await runTaskflow([
  'close',
  '--cwd', expectedPreStagedFixture.targetRepo,
  '--profile', expectedPreStagedFixture.profilePath,
  '--task', expectedPreStagedFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', expectedPreStagedFixture.deliveryCommit,
  '--write',
  '--no-commit',
  '--json'
]) as any;
assert.equal(expectedPreStaged.evidence.governedCommitBundle.failClosed, false, 'expected pre-staged bundle files must not fail isolation');
assert.equal(expectedPreStaged.evidence.governedCommitBundle.targetRepo.indexIsolation.verified, true);
assert.equal(expectedPreStaged.evidence.governedCommitBundle.planningRepo.indexIsolation.verified, true);
assert.ok(
  expectedPreStaged.evidence.governedCommitBundle.targetRepo.indexIsolation.preStagedFiles.includes(`.atm/history/evidence/${expectedPreStagedFixture.taskId}.json`),
  'target diagnostics must preserve expected pre-staged bundle file'
);
assert.ok(
  expectedPreStaged.evidence.governedCommitBundle.planningRepo.indexIsolation.preStagedFiles.includes(`docs/tasks/${expectedPreStagedFixture.taskId}.task.md`),
  'planning diagnostics must preserve expected pre-staged bundle file'
);

const autoCommitFixture = await makeDualRepoCloseFixture('autocommit');
const autoCommit = await runTaskflow([
  'close',
  '--cwd', autoCommitFixture.targetRepo,
  '--task', autoCommitFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', autoCommitFixture.deliveryCommit,
  '--write',
  '--json'
]) as any;
assert.equal(autoCommit.evidence.governedCommitBundle.commitMode, 'auto-commit');
assert.equal(autoCommit.evidence.governedCommitBundle.targetRepo.status, 'committed');
assert.equal(autoCommit.evidence.governedCommitBundle.planningRepo.status, 'committed');
assert.ok(autoCommit.evidence.governedCommitBundle.targetRepo.commitSha, 'auto-commit target bundle must report commitSha');
assert.ok(autoCommit.evidence.governedCommitBundle.planningRepo.commitSha, 'auto-commit planning bundle must report commitSha');
assert.equal(autoCommit.evidence.governedCommitBundle.failClosed, false);
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoCommitFixture.targetRepo, encoding: 'utf8' }).trim(), `chore(taskflow): close ${autoCommitFixture.taskId} target governance bundle`);
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoCommitFixture.planningRepo, encoding: 'utf8' }).trim(), `docs(taskflow): close ${autoCommitFixture.taskId} planning bundle`);

const missingPlanningFixture = await makeDualRepoCloseFixture('missingplan');
const missingTaskPath = path.join(missingPlanningFixture.targetRepo, '.atm/history/tasks', `${missingPlanningFixture.taskId}.json`);
const missingTask = JSON.parse(readFileSync(missingTaskPath, 'utf8')) as any;
missingTask.source.planPath = path.join(missingPlanningFixture.planningRepo, 'docs/tasks/DOES-NOT-EXIST.task.md');
writeJson(missingTaskPath, missingTask);
await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', missingPlanningFixture.targetRepo,
    '--task', missingPlanningFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', missingPlanningFixture.deliveryCommit,
    '--write',
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE'
);

async function makePlanningAuthorityCloseFixture(label: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-planning-authority-${label}-`));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: `target-planning-authority-${label}`, type: 'module' });
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

  const fixtureTaskId = `TASK-PLAN-${label.toUpperCase()}`;
  const planPath = path.join(planningRepo, 'docs', 'tasks', `${fixtureTaskId}.task.md`);
  const rosterPath = path.join(planningRepo, 'docs', 'tasks', 'README.md');
  const reportPath = 'docs/reports/planning-report.md';
  writeText(planPath, [
    '---',
    `task_id: ${fixtureTaskId}`,
    'title: "Planning authority close fixture"',
    'status: running',
    '---',
    `# ${fixtureTaskId}`,
    ''
  ].join('\n'));
  writeText(rosterPath, [
    '| Task ID | Title | Status |',
    '| --- | --- | --- |',
    `| [${fixtureTaskId}](./${fixtureTaskId}.task.md) | Planning authority close fixture | running |`,
    ''
  ].join('\n'));
  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: `planning-authority-${label}-profile`,
    name: 'Planning Authority Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-PLAN',
    taskId: {
      format: 'TASK-PLAN-NNNN'
    },
    template: {
      defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}'
    },
    capabilities: {
      supportsDryRun: true,
      supportsWrite: false
    },
    delegation: {
      hint: 'Planning repo owns delivery artifacts and roster closeback.',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: {
          mode: 'host-opener',
          prefix: 'TASK-PLAN',
          format: 'TASK-PLAN-NNNN'
        },
        resolveCanonicalOutputPath: {
          mode: 'host-opener',
          pattern: 'docs/tasks/${taskId}.task.md',
          directory: 'docs/tasks'
        },
        rosterSyncPolicy: 'inline',
        rosterSync: {
          indexPath: 'docs/tasks/README.md'
        },
        fallbackBehavior: {
          mode: 'template-only-fallback',
          reason: 'fallback'
        }
      },
      writerInvocation: {
        describeOnly: false,
        displayHint: 'node tools/task-card-opener.js --write --task ${taskId}'
      }
    }
  });
  writeJson(path.join(targetRepo, '.atm/history/tasks', `${fixtureTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: fixtureTaskId,
    title: 'Planning authority close fixture',
    status: 'ready',
    scopePaths: [reportPath],
    deliverables: [reportPath],
    planningRepo: 'planning',
    targetRepo: 'target',
    closureAuthority: 'planning_repo',
    source: {
      planPath,
      sectionTitle: fixtureTaskId,
      headingLine: 1,
      hash: 'planning-authority-close-fixture'
    }
  });
  execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base target planning-authority fixture'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base planning authority fixture'], { cwd: planningRepo, stdio: 'ignore' });
  const basePlanningCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: planningRepo, encoding: 'utf8' }).trim();

  const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', fixtureTaskId]);
  assert.equal(claim.ok, true, 'planning authority fixture must be claimable');
  writeText(path.join(planningRepo, reportPath), 'planning authority delivered\n');
  execFileSync('git', ['add', reportPath], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'deliver planning authority fixture'], { cwd: planningRepo, stdio: 'ignore' });
  const deliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: planningRepo, encoding: 'utf8' }).trim();
  writeText(planPath, [
    '---',
    `task_id: ${fixtureTaskId}`,
    'title: "Planning authority close fixture"',
    'status: done',
    '---',
    `# ${fixtureTaskId}`,
    ''
  ].join('\n'));
  writeJson(path.join(targetRepo, '.atm/history/evidence', `${fixtureTaskId}.json`), {
    taskId: fixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'planning authority fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['validate:cli'],
      artifactPaths: [reportPath],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate planning authority taskflow close fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  return { targetRepo, planningRepo, taskId: fixtureTaskId, planPath, profilePath: path.join(planningRepo, 'taskflow.profile.json'), basePlanningCommit, deliveryCommit, reportPath };
}

const planningAuthorityDryRunFixture = await makePlanningAuthorityCloseFixture('dryrun');
const planningAuthorityDryRun = await runTaskflow([
  'close',
  '--cwd', planningAuthorityDryRunFixture.targetRepo,
  '--profile', planningAuthorityDryRunFixture.profilePath,
  '--task', planningAuthorityDryRunFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', planningAuthorityDryRunFixture.deliveryCommit,
  '--json'
]) as any;
assert.equal(planningAuthorityDryRun.ok, true);
assert.equal(planningAuthorityDryRun.evidence.closeMode, 'historical-delivery-close');
assert.equal(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.ok, true);
assert.equal(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.repoRoot, planningAuthorityDryRunFixture.planningRepo);
assert.ok(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.matchedFiles.includes(planningAuthorityDryRunFixture.reportPath));
assert.ok(planningAuthorityDryRun.evidence.closebackPlan.backendCommand.includes('--historical-delivery-repo'));

await assert.rejects(
  () => runTaskflow([
    'close',
    '--cwd', planningAuthorityDryRunFixture.targetRepo,
    '--profile', planningAuthorityDryRunFixture.profilePath,
    '--task', planningAuthorityDryRunFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', planningAuthorityDryRunFixture.basePlanningCommit,
    '--json'
  ]),
  (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_PLANNING_DELIVERY_INVALID'
);

const planningAuthorityStageFixture = await makePlanningAuthorityCloseFixture('stageonly');
const planningAuthorityStage = await runTaskflow([
  'close',
  '--cwd', planningAuthorityStageFixture.targetRepo,
  '--profile', planningAuthorityStageFixture.profilePath,
  '--task', planningAuthorityStageFixture.taskId,
  '--actor', 'validator',
  '--historical-delivery', planningAuthorityStageFixture.deliveryCommit,
  '--write',
  '--no-commit',
  '--json'
]) as any;
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.commitMode, 'stage-only');
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.targetRepo.status, 'staged');
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.planningRepo.status, 'staged');
assert.equal(planningAuthorityStage.evidence.backendResult.ok, true);
const planningAuthorityTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: planningAuthorityStageFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const planningAuthorityPlanningStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: planningAuthorityStageFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(planningAuthorityTargetStaged.includes(`.atm/history/tasks/${planningAuthorityStageFixture.taskId}.json`), 'planning authority stage target bundle must stage task json');
assert.deepEqual(planningAuthorityPlanningStaged, ['docs/tasks/README.md', `docs/tasks/${planningAuthorityStageFixture.taskId}.task.md`], 'planning authority stage planning bundle must exact-stage card and roster only');

console.log('[taskflow-dryrun:test] ok');
