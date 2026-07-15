import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTaskflow } from '../../taskflow.js';
function writeText(filePath, text) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf8');
}
function writeJson(filePath, value) {
    writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
function initGitRepo(repo) {
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}
function writeProfile(planningRepo, input) {
    writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
        schemaId: 'taskflow.profile.v1',
        id: `${input.family.toLowerCase()}-framework-opener-profile`,
        name: `${input.family} Framework Opener Profile`,
        repoLabel: 'Framework Planning Repo',
        ownerRepo: input.ownerRepo ?? 'AI-Atomic-Framework',
        taskIdPrefix: input.family,
        taskId: {
            format: `${input.family}-NNNN`
        },
        template: {
            defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}'
        },
        capabilities: {
            supportsDryRun: true,
            supportsWrite: false
        },
        delegation: {
            hint: 'Planning repo owns cards; framework target owns runtime import.',
            openerPath: 'tools/task-card-opener.js',
            policy: {
                allocateTaskId: {
                    mode: 'host-opener',
                    prefix: input.family,
                    format: `${input.family}-NNNN`
                },
                resolveCanonicalOutputPath: {
                    mode: 'host-opener',
                    pattern: 'docs/tasks/${taskId}.task.md',
                    directory: 'docs/tasks'
                },
                rosterSyncPolicy: 'none',
                fallbackBehavior: {
                    mode: 'template-only-fallback',
                    reason: 'No host opener policy should bypass framework authority.'
                }
            },
            writerInvocation: {
                describeOnly: false,
                displayHint: 'node tools/task-card-opener.js --write --task ${taskId}'
            }
        }
    });
}
function makeFixture() {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-opener-'));
    const targetRepo = path.join(tempRoot, 'framework-target');
    const planningRepo = path.join(tempRoot, 'planning');
    initGitRepo(targetRepo);
    initGitRepo(planningRepo);
    writeJson(path.join(targetRepo, 'package.json'), { name: 'framework-target', type: 'module' });
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
    return { targetRepo, planningRepo };
}
const noProfile = await runTaskflow(['open', '--dry-run']);
assert.equal(noProfile.ok, true);
assert.equal(noProfile.writeReadinessHint.status, 'fallback');
assert.equal(noProfile.evidence.orchestrationPlan.targetRepository, 'adopter-repo');
assert.equal(noProfile.evidence.orchestrationPlan.nextDryRunCommand, 'node atm.mjs taskflow open --dry-run --title "New Task" --json');
assert.equal(noProfile.evidence.orchestrationPlan.nextImportCommand, null);
const fixture = makeFixture();
writeProfile(fixture.planningRepo, { family: 'ATM-GOV' });
const profilePath = path.join(fixture.planningRepo, 'taskflow.profile.json');
const dryRun = await runTaskflow([
    'open',
    '--cwd', fixture.targetRepo,
    '--profile', profilePath,
    '--dry-run',
    '--title', 'Framework taskflow opener lane',
    '--json'
]);
assert.equal(dryRun.ok, true);
assert.equal(dryRun.evidence.hostPolicyDecision.taskId, 'ATM-GOV-0001');
assert.equal(dryRun.evidence.orchestrationPlan.planningCard, 'docs/tasks/ATM-GOV-0001.task.md');
assert.equal(dryRun.evidence.orchestrationPlan.targetRepository, 'AI-Atomic-Framework');
assert.ok(dryRun.evidence.orchestrationPlan.nextDryRunCommand.includes('node atm.mjs taskflow open --dry-run'));
assert.ok(dryRun.evidence.orchestrationPlan.nextImportCommand.includes('node atm.mjs tasks import --from'));
const writeResult = await runTaskflow([
    'open',
    '--cwd', fixture.targetRepo,
    '--profile', profilePath,
    '--write',
    '--title', 'Framework taskflow opener lane',
    '--json'
]);
assert.equal(writeResult.ok, true);
assert.equal(writeResult.evidence.hostPolicyDecision.taskId, 'ATM-GOV-0001');
assert.equal(writeResult.evidence.generation.outputRepoRoot, fixture.planningRepo);
assert.ok(readFileSync(path.join(fixture.planningRepo, 'docs/tasks/ATM-GOV-0001.task.md'), 'utf8').includes('ATM-GOV-0001'));
assert.ok(readFileSync(path.join(fixture.targetRepo, '.atm/history/tasks/ATM-GOV-0001.json'), 'utf8').includes('ATM-GOV-0001'));
const driftFixture = makeFixture();
writeProfile(driftFixture.planningRepo, { family: 'ATM-GOV' });
writeText(path.join(driftFixture.planningRepo, 'docs/tasks/TASK-RFT-0007.task.md'), [
    '---',
    'task_id: TASK-RFT-0007',
    'title: "Framework taskflow opener lane"',
    '---',
    '',
    '# TASK-RFT-0007 Framework taskflow opener lane',
    ''
].join('\n'));
const driftProfilePath = path.join(driftFixture.planningRepo, 'taskflow.profile.json');
const driftDryRun = await runTaskflow([
    'open',
    '--cwd', driftFixture.targetRepo,
    '--profile', driftProfilePath,
    '--dry-run',
    '--title', 'Framework taskflow opener lane',
    '--json'
]);
assert.equal(driftDryRun.messages[0].code, 'ATM_TASK_ID_FAMILY_DRIFT');
assert.equal(driftDryRun.evidence.hostPolicyDecision.familyDrift.existingFamily, 'TASK-RFT');
assert.equal(driftDryRun.evidence.hostPolicyDecision.familyDrift.requestedFamily, 'ATM-GOV');
await assert.rejects(() => runTaskflow([
    'open',
    '--cwd', driftFixture.targetRepo,
    '--profile', driftProfilePath,
    '--write',
    '--title', 'Framework taskflow opener lane',
    '--json'
]), (err) => err.code === 'ATM_TASK_ID_FAMILY_DRIFT');
console.log('[taskflow-framework-opener:test] ok');
