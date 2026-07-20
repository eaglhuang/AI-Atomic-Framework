import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../../next.js';
import { runTaskflow } from '../../../taskflow.js';
import { initGitRepo, makeDualRepoCloseFixture, writeJson, writeText } from './fixtures.js';
async function makeUncommittedDeliverablesFixture(label, customTaskDoc) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-del-${label}-`));
    const targetRepo = path.join(tempRoot, 'target');
    const planningRepo = path.join(tempRoot, 'planning');
    initGitRepo(targetRepo);
    initGitRepo(planningRepo);
    writeJson(path.join(targetRepo, 'package.json'), { name: `target-del-${label}`, type: 'module' });
    writeJson(path.join(targetRepo, '.atm/config.json'), {
        schemaVersion: 'atm.config.v0.1',
        layoutVersion: 2,
        paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
        taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
    });
    writeJson(path.join(targetRepo, '.atm/runtime/identity/default.json'), {
        actorId: 'validator', gitName: 'ATM Validator', gitEmail: 'validator@example.invalid', updatedAt: new Date().toISOString()
    });
    const fixtureTaskId = `TASK-DEL-${label.toUpperCase()}`;
    const planPath = path.join(planningRepo, 'docs', 'tasks', `${fixtureTaskId}.task.md`);
    writeText(planPath, [
        '---',
        `task_id: ${fixtureTaskId}`,
        'title: "Deliverables test fixture"',
        'status: running',
        '---',
        `# ${fixtureTaskId}`
    ].join('\n'));
    writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
        schemaId: 'taskflow.profile.v1',
        id: `del-profile-${label}`,
        name: 'Deliverables Profile',
        repoLabel: 'Planning Repo',
        ownerRepo: 'planning',
        taskIdPrefix: 'TASK-DEL',
        taskId: { format: 'TASK-DEL-NNNN' },
        template: { defaultMarkdown: '# ${taskId} ${title}' },
        capabilities: { supportsDryRun: true, supportsWrite: false },
        delegation: {
            hint: 'hint', openerPath: 'tools/task-card-opener.js',
            policy: {
                allocateTaskId: { mode: 'host-opener', prefix: 'TASK-DEL', format: 'TASK-DEL-NNNN' },
                resolveCanonicalOutputPath: { mode: 'host-opener', pattern: 'docs/tasks/${taskId}.task.md', directory: 'docs/tasks' },
                rosterSyncPolicy: 'none', fallbackBehavior: { mode: 'template-only-fallback', reason: 'fallback' }
            },
            writerInvocation: { describeOnly: false, displayHint: 'node tools/task-card-opener.js --write --task ${taskId}' }
        }
    });
    const taskDoc = {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: fixtureTaskId,
        title: 'Deliverables test fixture',
        status: 'ready',
        scopePaths: ['src/deliver.txt', 'src/other.txt'],
        deliverables: ['src/deliver.txt'],
        targetAllowedFiles: ['src/deliver.txt'],
        planningRepo: 'planning',
        targetRepo: 'target',
        closureAuthority: 'target_repo'
    };
    if (customTaskDoc) {
        customTaskDoc(taskDoc);
    }
    writeJson(path.join(targetRepo, '.atm/history/tasks', `${fixtureTaskId}.json`), taskDoc);
    writeText(path.join(targetRepo, 'src/other.txt'), 'baseline\n');
    execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base target'], { cwd: targetRepo, stdio: 'ignore' });
    const baseCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetRepo, encoding: 'utf8' }).trim();
    execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base planning'], { cwd: planningRepo, stdio: 'ignore' });
    const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', fixtureTaskId]);
    assert.equal(claim.ok, true);
    return {
        targetRepo,
        planningRepo,
        taskId: fixtureTaskId,
        planPath,
        profilePath: path.join(planningRepo, 'taskflow.profile.json'),
        baseCommitSha
    };
}
// 1. Success case: uncommitted declared deliverables included in stageFiles
const successDelFixture = await makeUncommittedDeliverablesFixture('success');
writeText(path.join(successDelFixture.targetRepo, 'src/deliver.txt'), 'content\n');
writeText(path.join(successDelFixture.targetRepo, 'src/unrelated.txt'), 'unrelated content\n');
const dryRunResult = await runTaskflow([
    'close',
    '--cwd', successDelFixture.targetRepo,
    '--profile', successDelFixture.profilePath,
    '--task', successDelFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(dryRunResult.ok, true);
const stageFiles = dryRunResult.evidence.governedCommitBundle.targetRepo.stageFiles;
assert.ok(stageFiles.includes('src/deliver.txt'), 'uncommitted deliverables should be staged');
assert.ok(!stageFiles.includes('src/unrelated.txt'), 'unrelated files should be excluded');
assert.deepEqual(dryRunResult.evidence.governedCommitBundle.targetDeliveryFiles, ['src/deliver.txt']);
assert.deepEqual(dryRunResult.evidence.governedCommitBundle.excludedDirtyFiles, ['src/unrelated.txt']);
const writeDelFixture = await makeUncommittedDeliverablesFixture('write');
writeText(path.join(writeDelFixture.targetRepo, 'src/deliver.txt'), 'content\n');
writeText(path.join(writeDelFixture.targetRepo, 'src/unrelated.txt'), 'unrelated content\n');
writeJson(path.join(writeDelFixture.targetRepo, '.atm/history/evidence', `${writeDelFixture.taskId}.json`), {
    taskId: writeDelFixture.taskId,
    evidence: [{
            evidenceKind: 'validation',
            evidenceType: 'test',
            summary: 'uncommitted delivery close fixture evidence',
            producedBy: 'validator',
            freshness: 'fresh',
            validationPasses: ['validate:cli'],
            artifactPaths: ['src/deliver.txt'],
            createdAt: new Date().toISOString(),
            commandRuns: [{
                    command: 'validate uncommitted delivery close fixture',
                    exitCode: 0,
                    stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
                }]
        }]
});
writeJson(path.join(writeDelFixture.targetRepo, '.atm/history/evidence', `${writeDelFixture.taskId}.closure-packet.json`), {
    schemaId: 'atm.closurePacket.v1',
    taskId: writeDelFixture.taskId
});
const writeDelClose = await runTaskflow([
    'close',
    '--cwd', writeDelFixture.targetRepo,
    '--profile', writeDelFixture.profilePath,
    '--task', writeDelFixture.taskId,
    '--actor', 'validator',
    '--write',
    '--json'
]);
assert.equal(writeDelClose.ok, true);
assert.ok(writeDelClose.evidence.preCloseDeliveryCommit?.commitSha, 'taskflow close must create a governed delivery commit for uncommitted deliverables');
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: writeDelFixture.targetRepo, encoding: 'utf8' }).trim(), `chore(taskflow): close ${writeDelFixture.taskId} target governance bundle`);
assert.equal(execFileSync('git', ['log', '-2', '--pretty=%s'], { cwd: writeDelFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/)[1], `chore(taskflow): deliver ${writeDelFixture.taskId} source bundle`);
const writeDelDeliveryFiles = execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD~1'], { cwd: writeDelFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(writeDelDeliveryFiles, ['src/deliver.txt'], 'delivery commit must include only declared deliverables');
assert.ok(execFileSync('git', ['status', '--short'], { cwd: writeDelFixture.targetRepo, encoding: 'utf8' }).includes('src/unrelated.txt'), 'unrelated dirty file must remain untouched');
// 2. Scope fallback case: when targetAllowedFiles is absent, scopePaths define allowed delivery files
const failClosedFixture = await makeUncommittedDeliverablesFixture('failclosed', (doc) => {
    doc.targetAllowedFiles = []; // fallback to scopePaths
});
writeText(path.join(failClosedFixture.targetRepo, 'src/deliver.txt'), 'content\n');
writeText(path.join(failClosedFixture.targetRepo, 'src/other.txt'), 'modified\n');
writeJson(path.join(failClosedFixture.targetRepo, '.atm/history/evidence', `${failClosedFixture.taskId}.json`), {
    taskId: failClosedFixture.taskId,
    evidence: [{
            evidenceKind: 'validation',
            evidenceType: 'test',
            summary: 'fail-closed scope amendment fixture evidence',
            producedBy: 'validator',
            freshness: 'fresh',
            validationPasses: ['validate:cli'],
            artifactPaths: ['src/deliver.txt'],
            createdAt: new Date().toISOString(),
            commandRuns: [{
                    command: 'validate fail-closed scope amendment fixture',
                    exitCode: 0,
                    stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
                }]
        }]
});
const failClosedResult = await runTaskflow([
    'close',
    '--cwd', failClosedFixture.targetRepo,
    '--profile', failClosedFixture.profilePath,
    '--task', failClosedFixture.taskId,
    '--actor', 'validator',
    '--write',
    '--json'
]);
assert.equal(failClosedResult.ok, true);
assert.deepEqual(failClosedResult.evidence.preCloseDeliveryCommit.stageFiles, ['src/deliver.txt', 'src/other.txt']);
assert.equal(failClosedResult.evidence.governedCommitBundle.scopeAmendment.required, false);
// 3. Legal extensionless file deliverables must not be misclassified as directory declarations
const extensionlessFixture = await makeUncommittedDeliverablesFixture('extensionless', (doc) => {
    doc.scopePaths = ['Dockerfile'];
    doc.deliverables = ['Dockerfile'];
    doc.targetAllowedFiles = ['Dockerfile'];
});
writeText(path.join(extensionlessFixture.targetRepo, 'Dockerfile'), 'FROM scratch\n');
const extensionlessDryRun = await runTaskflow([
    'close',
    '--cwd', extensionlessFixture.targetRepo,
    '--profile', extensionlessFixture.profilePath,
    '--task', extensionlessFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(extensionlessDryRun.ok, true);
assert.deepEqual(extensionlessDryRun.evidence.governedCommitBundle.targetDeliveryFiles, ['Dockerfile']);
assert.equal(extensionlessDryRun.evidence.governedCommitBundle.scopeAmendment.required, false);
// 4. Out-of-scope files in historical delivery with and without waiver
const outOfScopeFixture = await makeUncommittedDeliverablesFixture('outofscope', (doc) => {
    doc.scopePaths = ['src/deliver.txt'];
    doc.deliverables = ['src/deliver.txt'];
    doc.targetAllowedFiles = ['src/deliver.txt'];
    doc.source = { planPath: 'docs/tasks/TASK-DEL-OUTOFSCOPE.task.md' };
});
const outOfScopeTaskPath = path.join(outOfScopeFixture.targetRepo, '.atm/history/tasks', `${outOfScopeFixture.taskId}.json`);
const outOfScopeTaskDoc = JSON.parse(readFileSync(outOfScopeTaskPath, 'utf8'));
outOfScopeTaskDoc.source.planPath = outOfScopeFixture.planPath;
writeJson(outOfScopeTaskPath, outOfScopeTaskDoc);
// Commit the out-of-scope and deliverable changes to Git to simulate a historical delivery
writeText(path.join(outOfScopeFixture.targetRepo, 'src/other.txt'), 'modified out of scope\n');
writeText(path.join(outOfScopeFixture.targetRepo, 'src/deliver.txt'), 'content\n');
execFileSync('git', ['add', '.'], { cwd: outOfScopeFixture.targetRepo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'historical delivery with out of scope file'], { cwd: outOfScopeFixture.targetRepo, stdio: 'ignore' });
const deliveryCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: outOfScopeFixture.targetRepo, encoding: 'utf8' }).trim();
// Write dummy evidence for outOfScopeFixture
writeJson(path.join(outOfScopeFixture.targetRepo, '.atm/history/evidence', `${outOfScopeFixture.taskId}.json`), {
    schemaVersion: 'atm.evidence.v0.1',
    workItemId: outOfScopeFixture.taskId,
    evidence: [{
            evidenceKind: 'validation',
            evidenceType: 'test',
            summary: 'out-of-scope close fixture evidence',
            producedBy: 'validator',
            freshness: 'fresh',
            validationPasses: ['validate:cli'],
            artifactPaths: ['src/deliver.txt'],
            createdAt: new Date().toISOString(),
            commandRuns: [{
                    command: 'validate out-of-scope close fixture',
                    exitCode: 0,
                    stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
                }]
        }]
});
writeJson(path.join(outOfScopeFixture.targetRepo, '.atm/history/evidence', `${outOfScopeFixture.taskId}.closure-packet.json`), {
    schemaId: 'atm.closurePacket.v1',
    taskId: outOfScopeFixture.taskId
});
// A. Dry-run close with --write and without waiver should fail-closed because of the committed out-of-scope file
let outOfScopeError = null;
let outOfScopeResult = null;
try {
    outOfScopeResult = await runTaskflow([
        'close',
        '--cwd', outOfScopeFixture.targetRepo,
        '--profile', outOfScopeFixture.profilePath,
        '--task', outOfScopeFixture.taskId,
        '--actor', 'validator',
        '--historical-delivery', deliveryCommitSha,
        '--write',
        '--json'
    ]);
}
catch (err) {
    outOfScopeError = err;
}
if (outOfScopeError) {
    assert.ok(outOfScopeError.code === 'ATM_CLI_COMMAND_FAILED' ||
        outOfScopeError.code === 'ATM_TASKFLOW_CLOSE_WRITE_BLOCKED' ||
        outOfScopeError.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED' ||
        outOfScopeError.message.includes('out-of-scope') ||
        outOfScopeError.message.includes('reconcile') ||
        outOfScopeError.message.includes('delivery'));
}
else {
    console.error('[DEBUG-TEST-FAIL] outOfScopeResult:', JSON.stringify(outOfScopeResult, null, 2));
    assert.equal(outOfScopeResult.ok, false);
    assert.ok(outOfScopeResult.messages.some((m) => m.code === 'ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED' ||
        m.text.includes('out-of-scope') ||
        m.text.includes('reconcile') ||
        m.text.includes('delivery')));
}
// B. Close with --write and approved waiver should succeed
const outOfScopeCloseWithWaiver = await runTaskflow([
    'close',
    '--cwd', outOfScopeFixture.targetRepo,
    '--profile', outOfScopeFixture.profilePath,
    '--task', outOfScopeFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', deliveryCommitSha,
    '--waiver-out-of-scope-delivery',
    '--reason', 'approved waiver for testing',
    '--write',
    '--json'
]);
if (!outOfScopeCloseWithWaiver.ok) {
    console.error('[DEBUG-TEST-FAIL] outOfScopeCloseWithWaiver failed:', JSON.stringify(outOfScopeCloseWithWaiver, null, 2));
}
assert.equal(outOfScopeCloseWithWaiver.ok, true);
const preCloseForeignFixture = await makeDualRepoCloseFixture('precheck-foreign-staged');
writeText(path.join(preCloseForeignFixture.targetRepo, '.atm/history/tasks/TASK-FOREIGN-0001.json'), '{"workItemId":"TASK-FOREIGN-0001"}\n');
execFileSync('git', ['add', '.atm/history/tasks/TASK-FOREIGN-0001.json'], { cwd: preCloseForeignFixture.targetRepo, stdio: 'ignore' });
const preCloseForeign = await runTaskflow([
    'pre-close',
    '--cwd', preCloseForeignFixture.targetRepo,
    '--profile', preCloseForeignFixture.profilePath,
    '--task', preCloseForeignFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', preCloseForeignFixture.deliveryCommit,
    '--json'
]);
assert.equal(preCloseForeign.command, 'taskflow pre-close');
assert.equal(preCloseForeign.schemaId, 'atm.taskflowPreCloseResult.v1');
assert.equal(preCloseForeign.ok, false, 'foreign staged governance must block pre-close');
assert.ok(preCloseForeign.evidence.historicalClosePreflight.blockers.some((entry) => entry.id === 'unexpectedStagedTasks'));
assert.deepEqual(preCloseForeign.evidence.historicalClosePreflight.unexpectedStagedTasks.map((entry) => entry.taskId), ['TASK-FOREIGN-0001']);
assert.ok(preCloseForeign.evidence.historicalClosePreflight.writeRollbackSummary.operatorWarnings.some((entry) => entry.includes('silently unstage')));
const preCloseNonBundleFixture = await makeDualRepoCloseFixture('precheck-nonbundle-staged');
writeText(path.join(preCloseNonBundleFixture.targetRepo, 'packages/cli/src/commands/hook-hotfix.ts'), 'export const hotfix = true;\n');
execFileSync('git', ['add', 'packages/cli/src/commands/hook-hotfix.ts'], { cwd: preCloseNonBundleFixture.targetRepo, stdio: 'ignore' });
const preCloseNonBundle = await runTaskflow([
    'pre-close',
    '--cwd', preCloseNonBundleFixture.targetRepo,
    '--profile', preCloseNonBundleFixture.profilePath,
    '--task', preCloseNonBundleFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', preCloseNonBundleFixture.deliveryCommit,
    '--json'
]);
assert.equal(preCloseNonBundle.ok, false, 'non-bundle staged source files must block pre-close');
assert.ok(preCloseNonBundle.evidence.historicalClosePreflight.blockers.some((entry) => entry.id === 'unexpectedStagedNonBundleFiles'));
assert.ok(preCloseNonBundle.evidence.writeReadinessHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_UNEXPECTED_STAGED_FILES'), 'dry-run writeReadinessHint must surface non-bundle staged blockers');
assert.ok(preCloseNonBundle.evidence.historicalClosePreflight.unexpectedNonBundleStaged[0]?.restoreCommand?.includes('git lease stage-override'), 'non-bundle staged remediation must route through ATM stage-override lease, not raw git restore --staged');
const preCloseMixed = await runTaskflow([
    'pre-close',
    '--cwd', outOfScopeFixture.targetRepo,
    '--profile', outOfScopeFixture.profilePath,
    '--task', outOfScopeFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', deliveryCommitSha,
    '--json'
]);
assert.equal(preCloseMixed.ok, false, 'mixed historical delivery without waiver must block pre-close');
assert.ok(preCloseMixed.evidence.historicalClosePreflight.blockers.some((entry) => entry.id === 'mixedDeliveryCommit'));
const closeDryRunMixed = await runTaskflow([
    'close',
    '--cwd', outOfScopeFixture.targetRepo,
    '--profile', outOfScopeFixture.profilePath,
    '--task', outOfScopeFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', deliveryCommitSha,
    '--json'
]);
assert.equal(closeDryRunMixed.evidence.historicalClosePreflight.schemaId, 'atm.historicalClosePreflight.v1');
assert.ok(closeDryRunMixed.evidence.writeReadinessHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_MIXED_DELIVERY_COMMIT'));
const closeDryRunMixedWithWaiverAlias = await runTaskflow([
    'close',
    '--cwd', outOfScopeFixture.targetRepo,
    '--profile', outOfScopeFixture.profilePath,
    '--task', outOfScopeFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', deliveryCommitSha,
    '--waive-out-of-scope',
    '--reason', 'approved alias waiver for testing',
    '--json'
]);
assert.equal(closeDryRunMixedWithWaiverAlias.ok, true, 'taskflow close must accept --waive-out-of-scope as a waiver alias');
assert.equal(closeDryRunMixedWithWaiverAlias.evidence.closebackPlan.waiverOutOfScopeDelivery, true);
console.log('[taskflow-dryrun:uncommitted-deliverables] ok');
