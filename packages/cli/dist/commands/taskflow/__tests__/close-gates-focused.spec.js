import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../next.js';
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
function makeActiveIntent(input) {
    return {
        intentId: `intent-${input.taskId}`,
        taskId: input.taskId,
        teamRunId: null,
        actorId: input.actorId,
        baseCommit: 'base-fixture',
        resourceKeys: {
            files: input.files,
            atomIds: input.atomIds ?? [],
            atomCids: input.atomCids ?? [],
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
        },
        leaseEpoch: input.leaseEpoch ?? 1,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt: '2026-06-18T00:00:00.000Z',
        lane: 'direct-brokered',
        expiresAt: input.expiresAt ?? '2099-01-01T00:00:00.000Z'
    };
}
function writeBrokerRegistry(repo, activeIntents, options = {}) {
    writeJson(path.join(repo, '.atm/runtime/write-broker.registry.json'), {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'fixture-repo',
        workspaceId: 'main',
        ...(typeof options.currentEpoch === 'number' ? { currentEpoch: options.currentEpoch } : {}),
        activeIntents
    });
}
function readBranchRef(repo) {
    return execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
}
function writeBranchCommitQueueLock(repo, input) {
    const branchRef = input.branchRef ?? 'refs/heads/main';
    const safeName = branchRef.replace(/[^A-Za-z0-9._-]+/g, '-');
    const lockDir = path.join(repo, '.atm/runtime/locks', `git-commit-queue-${safeName}.lock`);
    mkdirSync(lockDir, { recursive: true });
    writeJson(path.join(lockDir, 'record.json'), {
        schemaId: 'atm.branchCommitQueueLock.v1',
        specVersion: '0.1.0',
        actorId: input.actorId,
        taskId: input.taskId ?? null,
        branchRef,
        branchName: branchRef.replace(/^refs\/heads\//, ''),
        headShaAtAcquire: input.headShaAtAcquire ?? 'fixture-head',
        createdAt: '2026-06-19T00:00:00.000Z'
    });
}
async function makeDualRepoCloseFixture(label) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-focused-${label}-`));
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
    const fixtureTaskId = `TASK-FOCUSED-${label.toUpperCase()}`;
    const planPath = path.join(planningRepo, 'docs', 'tasks', `${fixtureTaskId}.task.md`);
    const rosterPath = path.join(planningRepo, 'docs', 'tasks', 'README.md');
    writeText(planPath, [
        '---',
        `task_id: ${fixtureTaskId}`,
        'title: "Focused close fixture"',
        'status: running',
        '---',
        `# ${fixtureTaskId}`,
        ''
    ].join('\n'));
    writeText(rosterPath, [
        '| Task ID | Title | Status |',
        '| --- | --- | --- |',
        `| [${fixtureTaskId}](./${fixtureTaskId}.task.md) | Focused close fixture | running |`,
        ''
    ].join('\n'));
    writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
        schemaId: 'taskflow.profile.v1',
        id: `focused-close-${label}-profile`,
        name: 'Focused Close Profile',
        repoLabel: 'Planning Repo',
        ownerRepo: 'planning',
        taskIdPrefix: 'TASK-FOCUSED',
        taskId: {
            format: 'TASK-FOCUSED-NNNN'
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
                    prefix: 'TASK-FOCUSED',
                    format: 'TASK-FOCUSED-NNNN'
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
        title: 'Focused close fixture',
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
            hash: 'focused-close-fixture'
        }
    });
    execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base target fixture'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base planning fixture'], { cwd: planningRepo, stdio: 'ignore' });
    const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', fixtureTaskId]);
    assert.equal(claim.ok, true, 'focused close fixture must be claimable');
    writeText(path.join(targetRepo, 'src/deliver.txt'), 'delivered\n');
    execFileSync('git', ['add', 'src/deliver.txt'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'deliver fixture'], { cwd: targetRepo, stdio: 'ignore' });
    const deliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetRepo, encoding: 'utf8' }).trim();
    writeJson(path.join(targetRepo, '.atm/history/evidence', `${fixtureTaskId}.json`), {
        taskId: fixtureTaskId,
        evidence: [{
                evidenceKind: 'validation',
                evidenceType: 'test',
                summary: 'focused fixture evidence',
                producedBy: 'validator',
                freshness: 'fresh',
                validationPasses: ['validate:cli'],
                artifactPaths: ['src/deliver.txt'],
                createdAt: new Date().toISOString(),
                commandRuns: [{
                        command: 'validate focused taskflow close fixture',
                        exitCode: 0,
                        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
                    }]
            }]
    });
    writeText(planPath, [
        '---',
        `task_id: ${fixtureTaskId}`,
        'title: "Focused close fixture"',
        'status: planned',
        '---',
        `# ${fixtureTaskId}`,
        ''
    ].join('\n'));
    return { targetRepo, planningRepo, taskId: fixtureTaskId, profilePath: path.join(planningRepo, 'taskflow.profile.json'), deliveryCommit };
}
const staleEpochFixture = await makeDualRepoCloseFixture('stale-epoch');
writeBrokerRegistry(staleEpochFixture.targetRepo, [
    makeActiveIntent({
        taskId: staleEpochFixture.taskId,
        actorId: 'validator',
        files: ['src/deliver.txt'],
        atomIds: ['ATOM-SELF-EPOCH'],
        atomCids: ['CID-SELF-EPOCH']
    }),
    makeActiveIntent({
        taskId: 'TASK-OTHER-STALE-EPOCH',
        actorId: 'other',
        files: ['src/deliver.txt'],
        atomIds: ['ATOM-OTHER-EPOCH'],
        atomCids: ['CID-OTHER-EPOCH'],
        expiresAt: '2099-01-01T00:00:00.000Z'
    })
], { currentEpoch: 2 });
const staleEpochDryRun = await runTaskflow([
    'close',
    '--cwd', staleEpochFixture.targetRepo,
    '--profile', staleEpochFixture.profilePath,
    '--task', staleEpochFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(staleEpochDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict, 'takeoverRequired');
assert.ok(staleEpochDryRun.evidence.writeReadinessHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'), 'focused stale epoch regression must block close before commit tail');
const branchQueueFixture = await makeDualRepoCloseFixture('branch-queue');
writeBranchCommitQueueLock(branchQueueFixture.targetRepo, {
    actorId: 'other-writer',
    taskId: 'TASK-OTHER-FINALIZING',
    branchRef: readBranchRef(branchQueueFixture.targetRepo)
});
const branchQueueDryRun = await runTaskflow([
    'close',
    '--cwd', branchQueueFixture.targetRepo,
    '--profile', branchQueueFixture.profilePath,
    '--task', branchQueueFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(branchQueueDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy');
assert.ok(branchQueueDryRun.evidence.writeReadinessHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY'), 'focused branch queue regression must block close before commit tail');
console.log('ok: taskflow close focused gate regressions passed');
