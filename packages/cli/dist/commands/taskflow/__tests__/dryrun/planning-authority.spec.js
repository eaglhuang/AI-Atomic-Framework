import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../../next.js';
import { runTaskflow } from '../../../taskflow.js';
import { initGitRepo, writeJson, writeText } from './fixtures.js';
async function makePlanningAuthorityCloseFixture(label) {
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
]);
assert.equal(planningAuthorityDryRun.ok, true);
assert.equal(planningAuthorityDryRun.evidence.closeMode, 'historical-delivery-close');
assert.equal(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.ok, true);
assert.equal(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.repoRoot, planningAuthorityDryRunFixture.planningRepo);
assert.ok(planningAuthorityDryRun.evidence.closebackPlan.planningAuthorityDeliveryGate.matchedFiles.includes(planningAuthorityDryRunFixture.reportPath));
assert.ok(planningAuthorityDryRun.evidence.closebackPlan.backendCommand.includes('--historical-delivery-repo'));
await assert.rejects(() => runTaskflow([
    'close',
    '--cwd', planningAuthorityDryRunFixture.targetRepo,
    '--profile', planningAuthorityDryRunFixture.profilePath,
    '--task', planningAuthorityDryRunFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', planningAuthorityDryRunFixture.basePlanningCommit,
    '--json'
]), (err) => err.code === 'ATM_TASKFLOW_CLOSE_PLANNING_DELIVERY_INVALID');
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
]);
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.commitMode, 'stage-only');
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.targetRepo.status, 'staged');
assert.equal(planningAuthorityStage.evidence.governedCommitBundle.planningRepo.status, 'staged');
assert.equal(planningAuthorityStage.evidence.backendResult.ok, true);
const planningAuthorityTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: planningAuthorityStageFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const planningAuthorityPlanningStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: planningAuthorityStageFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(planningAuthorityTargetStaged.includes(`.atm/history/tasks/${planningAuthorityStageFixture.taskId}.json`), 'planning authority stage target bundle must stage task json');
const planningAuthorityPlanningCard = readFileSync(path.join(planningAuthorityStageFixture.planningRepo, `docs/tasks/${planningAuthorityStageFixture.taskId}.task.md`), 'utf8');
const planningAuthorityTransitionId = /lastTransitionId:\s*"([^"]+)"/.exec(planningAuthorityPlanningCard)?.[1];
assert.ok(planningAuthorityTransitionId, 'planning authority stage closeback must stamp a planning transition id');
assert.deepEqual(planningAuthorityPlanningStaged, [`.atm/history/task-events/${planningAuthorityStageFixture.taskId}/${planningAuthorityTransitionId}.json`, 'docs/tasks/README.md', `docs/tasks/${planningAuthorityStageFixture.taskId}.task.md`], 'planning authority stage planning bundle must exact-stage card, roster, and planning transition event');
console.log('[taskflow-dryrun:planning-authority] ok');
