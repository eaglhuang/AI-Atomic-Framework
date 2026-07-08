import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitBundle, finalizeTaskflowCommitBundle } from '../commit-bundle-assembly.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writeText(filePath, text) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf8');
}
function initGitRepo(repo) {
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'bootstrap'], { cwd: repo, stdio: 'ignore' });
}
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-bundle-'));
const targetRepo = path.join(tempRoot, 'target');
const planningRepo = path.join(tempRoot, 'planning');
initGitRepo(targetRepo);
initGitRepo(planningRepo);
const planPath = path.join(planningRepo, 'docs/tasks/TASK-BUNDLE-0001.task.md');
writeText(planPath, '# TASK-BUNDLE-0001\n');
writeJson(path.join(targetRepo, '.atm/history/tasks/TASK-BUNDLE-0001.json'), {
    workItemId: 'TASK-BUNDLE-0001',
    deliverables: ['src/app.ts'],
    scopePaths: ['src/app.ts'],
    source: { planPath }
});
writeText(path.join(targetRepo, 'src/app.ts'), 'export const value = 1;\n');
const bundle = buildTaskflowCommitBundle({
    cwd: targetRepo,
    taskId: 'TASK-BUNDLE-0001',
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: planPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
});
assert.equal(bundle.targetRepo.commitMessage, 'chore(taskflow): close TASK-BUNDLE-0001 target governance bundle');
assert.equal(bundle.planningRepo.commitMessage, 'docs(taskflow): close TASK-BUNDLE-0001 planning bundle');
assert.ok(bundle.targetDeliveryFiles.includes('src/app.ts'));
assert.ok(bundle.targetRepo.stageFiles.includes('.atm/history/tasks/TASK-BUNDLE-0001.json'), 'pre-close bundle must stage current-task governance files so historical close can carry the active task ledger state');
writeJson(path.join(targetRepo, '.atm/history/evidence/TASK-BUNDLE-0001.closure-packet.json'), {
    schemaId: 'atm.closurePacket.v1',
    taskId: 'TASK-BUNDLE-0001'
});
writeJson(path.join(targetRepo, '.atm/history/evidence/TASK-BUNDLE-0001.json'), {
    schemaId: 'atm.taskEvidence.v1',
    taskId: 'TASK-BUNDLE-0001'
});
writeJson(path.join(targetRepo, '.atm/history/task-events/TASK-BUNDLE-0001/import.json'), {
    schemaId: 'atm.taskTransition.v1',
    taskId: 'TASK-BUNDLE-0001',
    transitionId: 'import-1',
    action: 'import',
    command: 'node atm.mjs tasks import --from docs/tasks/TASK-BUNDLE-0001.task.md --write --json'
});
writeJson(path.join(targetRepo, '.atm/history/task-events/TASK-BUNDLE-0001/claim.json'), {
    schemaId: 'atm.taskTransition.v1',
    taskId: 'TASK-BUNDLE-0001',
    transitionId: 'claim-1',
    action: 'claim',
    command: 'node atm.mjs next --claim --task TASK-BUNDLE-0001 --actor validator --json'
});
const backendBundle = buildTaskflowCommitBundle({
    cwd: targetRepo,
    taskId: 'TASK-BUNDLE-0001',
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: planPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false,
    backendResult: {
        evidence: {
            taskPath: '.atm/history/tasks/TASK-BUNDLE-0001.json',
            closurePacketPath: '.atm/history/evidence/TASK-BUNDLE-0001.closure-packet.json',
            transitionPath: '.atm/history/task-events/TASK-BUNDLE-0001/close.json'
        }
    }
});
assert.ok(backendBundle.targetRepo.stageFiles.includes('.atm/history/tasks/TASK-BUNDLE-0001.json'), 'post-close bundle must stage task governance files once backend close artifacts exist');
assert.ok(backendBundle.targetRepo.stageFiles.includes('.atm/history/evidence/TASK-BUNDLE-0001.json'), 'post-close bundle must stage same-task evidence bundle');
assert.ok(backendBundle.targetRepo.stageFiles.includes('.atm/history/task-events/TASK-BUNDLE-0001/import.json'), 'post-close bundle must stage pre-close import history for the same task');
assert.ok(backendBundle.targetRepo.stageFiles.includes('.atm/history/task-events/TASK-BUNDLE-0001/claim.json'), 'post-close bundle must stage pre-close claim history for the same task');
const autoCommitTaskId = 'TASK-BUNDLE-0002';
const autoTargetRepo = path.join(tempRoot, 'target-auto');
const autoPlanningRepo = path.join(tempRoot, 'planning-auto');
initGitRepo(autoTargetRepo);
initGitRepo(autoPlanningRepo);
const autoPlanPath = path.join(autoPlanningRepo, 'docs/tasks/TASK-BUNDLE-0002.task.md');
writeText(autoPlanPath, `---\ntask_id: ${autoCommitTaskId}\nstatus: planned\n---\n# ${autoCommitTaskId}\n`);
writeJson(path.join(autoTargetRepo, '.atm/history/tasks/TASK-BUNDLE-0002.json'), {
    workItemId: autoCommitTaskId,
    title: `${autoCommitTaskId} fixture`,
    status: 'running',
    claim: {
        actorId: 'validator',
        leaseId: 'lease-bundle-0002',
        state: 'active'
    },
    deliverables: ['src/app.ts'],
    scopePaths: ['src/app.ts'],
    source: { planPath: autoPlanPath }
});
writeJson(path.join(autoTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0002.json'), {
    taskId: autoCommitTaskId,
    schemaId: 'atm.taskEvidence.v1'
});
writeJson(path.join(autoTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0002.closure-packet.json'), {
    taskId: autoCommitTaskId,
    schemaId: 'atm.closurePacket.v1'
});
writeText(path.join(autoTargetRepo, 'src/app.ts'), 'export const value = 2;\n');
mkdirSync(path.join(autoTargetRepo, '.atm', 'runtime', 'sessions'), { recursive: true });
writeJson(path.join(autoTargetRepo, '.atm', 'runtime', 'sessions', 'session-bundle-0002.json'), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId: 'session-bundle-0002',
    actorId: 'validator',
    taskId: autoCommitTaskId,
    claimLeaseId: 'lease-bundle-0002',
    status: 'active',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    heartbeatAt: '2026-06-20T00:00:00.000Z',
    taskPath: `.atm/history/tasks/${autoCommitTaskId}.json`,
    sourcePrompt: null,
    batchId: null,
    guidanceSessionId: null,
    editor: 'codex',
    gitName: 'ATM Validator',
    gitEmail: 'validator@example.invalid'
});
writeText(path.join(autoTargetRepo, 'scratch/foreign.txt'), 'foreign staged WIP\n');
execFileSync('git', ['add', 'scratch/foreign.txt'], { cwd: autoTargetRepo, stdio: 'ignore' });
process.env.ATM_GIT_NAME = 'ATM Validator';
process.env.ATM_GIT_EMAIL = 'validator@example.invalid';
const autoBundle = buildTaskflowCommitBundle({
    cwd: autoTargetRepo,
    taskId: autoCommitTaskId,
    actorId: 'validator',
    commitMode: 'auto-commit',
    planningMirrorPath: autoPlanPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
});
const autoFinal = await finalizeTaskflowCommitBundle({
    bundle: autoBundle,
    actorId: 'validator',
    taskId: autoCommitTaskId
});
assert.equal(autoFinal.failClosed, false, 'auto-commit bundle must complete even when other staged work exists');
assert.equal(autoFinal.targetRepo.status, 'committed');
assert.ok(autoFinal.targetRepo.commitSha, 'auto-commit must record a target commit SHA');
const autoTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: autoTargetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(autoTargetStaged.includes('scratch/foreign.txt'), 'parallel foreign staged work must remain staged');
// ATM-BUG-2026-07-07-049: the temp index used to commit the close bundle never
// touched the live index, so committed task files (e.g. src/app.ts) used to
// show up as a phantom "deleted in index" diff afterwards -- looking like the
// task had been reopened. commitRepoWithTemporaryIndex now resets exactly the
// committed paths in the live index to the new HEAD, so no residual diff
// should remain for them at all.
assert.ok(!autoTargetStaged.includes('src/app.ts'), 'committed task bundle files must not leave a phantom staged diff after close');
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoTargetRepo, encoding: 'utf8' }).trim(), `chore(taskflow): close ${autoCommitTaskId} target governance bundle`);
const sameRepoTaskId = 'TASK-BUNDLE-0003';
const sameRepo = path.join(tempRoot, 'same-repo');
initGitRepo(sameRepo);
const sameRepoPlanPath = path.join(sameRepo, 'docs/tasks/TASK-BUNDLE-0003.task.md');
writeText(sameRepoPlanPath, `---\ntask_id: ${sameRepoTaskId}\nstatus: running\n---\n# ${sameRepoTaskId}\n`);
writeJson(path.join(sameRepo, '.atm/history/tasks/TASK-BUNDLE-0003.json'), {
    workItemId: sameRepoTaskId,
    title: `${sameRepoTaskId} fixture`,
    status: 'running',
    claim: {
        actorId: 'validator',
        leaseId: 'lease-bundle-0003',
        state: 'active'
    },
    deliverables: ['src/app.ts'],
    scopePaths: ['src/app.ts'],
    source: { planPath: sameRepoPlanPath }
});
writeJson(path.join(sameRepo, '.atm/history/evidence/TASK-BUNDLE-0003.json'), {
    taskId: sameRepoTaskId,
    schemaId: 'atm.taskEvidence.v1'
});
writeJson(path.join(sameRepo, '.atm/history/evidence/TASK-BUNDLE-0003.closure-packet.json'), {
    taskId: sameRepoTaskId,
    schemaId: 'atm.closurePacket.v1'
});
writeJson(path.join(sameRepo, '.atm/history/task-events/TASK-BUNDLE-0003/close.json'), {
    taskId: sameRepoTaskId,
    action: 'close'
});
writeText(path.join(sameRepo, 'src/app.ts'), 'export const value = 3;\n');
execFileSync('git', ['add', '.'], { cwd: sameRepo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'base same repo fixture'], { cwd: sameRepo, stdio: 'ignore' });
writeText(sameRepoPlanPath, `---\ntask_id: ${sameRepoTaskId}\nstatus: done\n---\n# ${sameRepoTaskId}\n`);
writeText(path.join(sameRepo, 'scratch/foreign.txt'), 'foreign staged same-repo WIP\n');
execFileSync('git', ['add', 'scratch/foreign.txt'], { cwd: sameRepo, stdio: 'ignore' });
const sameRepoBundle = buildTaskflowCommitBundle({
    cwd: sameRepo,
    taskId: sameRepoTaskId,
    actorId: 'validator',
    commitMode: 'auto-commit',
    planningMirrorPath: sameRepoPlanPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false,
    backendResult: {
        evidence: {
            taskPath: `.atm/history/tasks/${sameRepoTaskId}.json`,
            closurePacketPath: `.atm/history/evidence/${sameRepoTaskId}.closure-packet.json`,
            transitionPath: `.atm/history/task-events/${sameRepoTaskId}/close.json`
        }
    }
});
const sameRepoFinal = await finalizeTaskflowCommitBundle({
    bundle: sameRepoBundle,
    actorId: 'validator',
    taskId: sameRepoTaskId
});
assert.equal(sameRepoFinal.failClosed, false, 'same-repo bundle must commit successfully');
assert.equal(sameRepoFinal.targetRepo.status, 'committed');
assert.equal(sameRepoFinal.planningRepo.status, 'committed');
assert.equal(sameRepoFinal.targetRepo.commitSha, sameRepoFinal.planningRepo.commitSha, 'same-repo close must share one commit');
const sameRepoStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: sameRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(sameRepoStaged.includes('scratch/foreign.txt'), 'foreign staged work must remain staged in same-repo mode');
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: sameRepo, encoding: 'utf8' }).trim(), `chore(taskflow): close ${sameRepoTaskId} target governance bundle`);
const amendedTaskId = 'TASK-BUNDLE-0004';
const amendedTargetRepo = path.join(tempRoot, 'target-amended');
const amendedPlanningRepo = path.join(tempRoot, 'planning-amended');
initGitRepo(amendedTargetRepo);
initGitRepo(amendedPlanningRepo);
const amendedPlanPath = path.join(amendedPlanningRepo, 'docs/tasks/TASK-BUNDLE-0004.task.md');
writeText(amendedPlanPath, `---\ntask_id: ${amendedTaskId}\nstatus: running\n---\n# ${amendedTaskId}\n`);
writeJson(path.join(amendedTargetRepo, '.atm/history/tasks/TASK-BUNDLE-0004.json'), {
    workItemId: amendedTaskId,
    title: `${amendedTaskId} fixture`,
    status: 'running',
    claim: {
        actorId: 'validator',
        leaseId: 'lease-bundle-0004',
        state: 'active',
        files: ['packages/**']
    },
    taskDirectionLock: {
        allowedFiles: ['packages/**']
    },
    deliverables: ['docs/guide.md'],
    scopePaths: ['docs/**', 'packages/**'],
    targetAllowedFiles: ['docs/**'],
    source: { planPath: amendedPlanPath }
});
writeText(path.join(amendedTargetRepo, 'packages/cli/src/runtime-scope.ts'), 'export const runtimeScoped = true;\n');
const amendedBundle = buildTaskflowCommitBundle({
    cwd: amendedTargetRepo,
    taskId: amendedTaskId,
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: amendedPlanPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
});
assert.equal(amendedBundle.failClosed, false, 'runtime-amended deliverables should not force historical lane fail-close');
assert.ok(amendedBundle.targetDeliveryFiles.includes('packages/cli/src/runtime-scope.ts'), 'claim-expanded runtime file must be treated as deliverable');
const externalTaskId = 'TASK-BUNDLE-0005';
const externalTargetRepo = path.join(tempRoot, 'target-external');
const externalPlanningRepo = path.join(tempRoot, 'planning-external');
initGitRepo(externalTargetRepo);
initGitRepo(externalPlanningRepo);
writeJson(path.join(externalTargetRepo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    taskLedger: {
        planningRoots: ['../planning-external/docs/ai_atomic_framework']
    }
});
const externalPlanPath = path.join(externalPlanningRepo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks', `${externalTaskId}.task.md`);
writeText(externalPlanPath, `---\ntask_id: ${externalTaskId}\nstatus: running\n---\n# ${externalTaskId}\n`);
writeJson(path.join(externalTargetRepo, '.atm/history/tasks', `${externalTaskId}.json`), {
    workItemId: externalTaskId,
    title: `${externalTaskId} fixture`,
    status: 'running',
    claim: {
        actorId: 'validator',
        leaseId: 'lease-bundle-0005',
        state: 'active',
        files: [
            'atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md',
            'src/runtime.txt'
        ]
    },
    taskDirectionLock: {
        allowedFiles: ['src/runtime.txt'],
        planningReadOnlyPaths: ['atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md'],
        planningMirrorPaths: ['atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md']
    },
    deliverables: ['src/runtime.txt'],
    scopePaths: ['src/runtime.txt'],
    source: { planPath: 'atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md' }
});
writeText(path.join(externalTargetRepo, 'src/runtime.txt'), 'external planning root\n');
const externalBundle = buildTaskflowCommitBundle({
    cwd: externalTargetRepo,
    taskId: externalTaskId,
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: 'atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md',
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
});
assert.equal(externalBundle.failClosed, false, 'stored external planning paths must not poison target deliverables');
assert.ok(externalBundle.targetDeliveryFiles.includes('src/runtime.txt'));
assert.ok(externalBundle.planningRepo.stageFiles.includes('docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-BUNDLE-0005.task.md'));
const proseTaskId = 'TASK-BUNDLE-0006';
const proseTargetRepo = path.join(tempRoot, 'target-prose');
const prosePlanningRepo = path.join(tempRoot, 'planning-prose');
initGitRepo(proseTargetRepo);
initGitRepo(prosePlanningRepo);
const prosePlanPath = path.join(prosePlanningRepo, 'docs/tasks/TASK-BUNDLE-0006.task.md');
writeText(prosePlanPath, `---\ntask_id: ${proseTaskId}\nstatus: running\n---\n# ${proseTaskId}\n`);
writeJson(path.join(proseTargetRepo, '.atm/history/tasks/TASK-BUNDLE-0006.json'), {
    workItemId: proseTaskId,
    title: `${proseTaskId} fixture`,
    status: 'running',
    claim: {
        actorId: 'validator',
        leaseId: 'lease-bundle-0006',
        state: 'active',
        files: ['src/runtime.txt']
    },
    taskDirectionLock: {
        allowedFiles: ['src/runtime.txt']
    },
    deliverables: [
        'Documentation explaining how adopter repositories extend atom health checks without forking ATM core.',
        'src/runtime.txt'
    ],
    scopePaths: ['src/runtime.txt'],
    source: { planPath: prosePlanPath }
});
writeText(path.join(proseTargetRepo, 'src/runtime.txt'), 'prose deliverable fallback\n');
const proseBundle = buildTaskflowCommitBundle({
    cwd: proseTargetRepo,
    taskId: proseTaskId,
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: prosePlanPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
});
assert.equal(proseBundle.failClosed, false, 'sentence-style deliverables must not fail close when canonical file deliverables still exist');
assert.ok(proseBundle.targetDeliveryFiles.includes('src/runtime.txt'));
// ATM-BUG-2026-07-07-046: taskflow close's own raw-git commit lane used to read
// whatever host git config happened to be set instead of the actor-scoped
// identity `node atm.mjs git commit` resolves. Isolate this check from the
// ATM_GIT_NAME/ATM_GIT_EMAIL env override the earlier auto-commit fixture set,
// so it exercises the per-actor identity file resolution path specifically.
const savedAtmGitName = process.env.ATM_GIT_NAME;
const savedAtmGitEmail = process.env.ATM_GIT_EMAIL;
delete process.env.ATM_GIT_NAME;
delete process.env.ATM_GIT_EMAIL;
try {
    const identityTaskId = 'TASK-BUNDLE-0007';
    const identityActorId = 'opt09-actor';
    const identityTargetRepo = path.join(tempRoot, 'target-identity');
    const identityPlanningRepo = path.join(tempRoot, 'planning-identity');
    initGitRepo(identityTargetRepo);
    initGitRepo(identityPlanningRepo);
    // Simulate host git config drifting away from the actor's registered identity
    // (e.g. a shared CI box, or a different agent's `git config` left behind).
    execFileSync('git', ['config', 'user.name', 'drifted-host'], { cwd: identityTargetRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'drifted-host@example.invalid'], { cwd: identityTargetRepo, stdio: 'ignore' });
    writeJson(path.join(identityTargetRepo, '.atm/runtime/identity/actors', `${identityActorId}.json`), {
        schemaId: 'atm.identityDefault.v1',
        specVersion: '0.1.0',
        actorId: identityActorId,
        gitName: 'OPT-09 Actor',
        gitEmail: 'opt09-actor@example.invalid',
        editor: null,
        provider: null,
        activeSessionId: null,
        updatedAt: '2026-07-08T00:00:00.000Z'
    });
    const identityPlanPath = path.join(identityPlanningRepo, 'docs/tasks/TASK-BUNDLE-0007.task.md');
    writeText(identityPlanPath, `---\ntask_id: ${identityTaskId}\nstatus: running\n---\n# ${identityTaskId}\n`);
    writeJson(path.join(identityTargetRepo, '.atm/history/tasks/TASK-BUNDLE-0007.json'), {
        workItemId: identityTaskId,
        title: `${identityTaskId} fixture`,
        status: 'running',
        claim: { actorId: identityActorId, leaseId: 'lease-bundle-0007', state: 'active' },
        deliverables: ['src/app.ts'],
        scopePaths: ['src/app.ts'],
        source: { planPath: identityPlanPath }
    });
    writeJson(path.join(identityTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0007.json'), {
        taskId: identityTaskId,
        schemaId: 'atm.taskEvidence.v1'
    });
    writeJson(path.join(identityTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0007.closure-packet.json'), {
        taskId: identityTaskId,
        schemaId: 'atm.closurePacket.v1'
    });
    writeText(path.join(identityTargetRepo, 'src/app.ts'), 'export const value = 7;\n');
    const identityBundle = buildTaskflowCommitBundle({
        cwd: identityTargetRepo,
        taskId: identityTaskId,
        actorId: identityActorId,
        commitMode: 'auto-commit',
        planningMirrorPath: identityPlanPath,
        rosterIndexPath: null,
        planningAuthorityDeliveryOk: false
    });
    const identityFinal = await finalizeTaskflowCommitBundle({
        bundle: identityBundle,
        actorId: identityActorId,
        taskId: identityTaskId
    });
    assert.equal(identityFinal.failClosed, false, 'identity fixture close must complete');
    assert.equal(identityFinal.targetRepo.status, 'committed');
    const identityAuthor = execFileSync('git', ['show', '-s', '--format=%an <%ae>', 'HEAD'], { cwd: identityTargetRepo, encoding: 'utf8' }).trim();
    assert.equal(identityAuthor, 'OPT-09 Actor <opt09-actor@example.invalid>', 'taskflow close commit must use the actor-scoped identity, not drifted host git config');
}
finally {
    if (savedAtmGitName === undefined)
        delete process.env.ATM_GIT_NAME;
    else
        process.env.ATM_GIT_NAME = savedAtmGitName;
    if (savedAtmGitEmail === undefined)
        delete process.env.ATM_GIT_EMAIL;
    else
        process.env.ATM_GIT_EMAIL = savedAtmGitEmail;
}
console.log('ok: commit bundle assembly spec passed');
