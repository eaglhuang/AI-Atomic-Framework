import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNext } from '../../../next.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, '../../../../../../../');
export async function makeDualRepoOpenFixture() {
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
export function writeText(filePath, text) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf8');
}
export function writeJson(filePath, value) {
    writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
export function initGitRepo(repo) {
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}
export function writeBranchCommitQueueLock(repo, input) {
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
export function readBranchRef(repo) {
    return execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
}
export function writeBrokerRegistry(repo, activeIntents, options = {}) {
    writeJson(path.join(repo, '.atm/runtime/write-broker.registry.json'), {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'fixture-repo',
        workspaceId: 'main',
        ...(typeof options.currentEpoch === 'number' ? { currentEpoch: options.currentEpoch } : {}),
        activeIntents
    });
}
export function makeActiveIntent(input) {
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
        leaseEpoch: 1,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt: new Date().toISOString(),
        lane: 'direct-brokered',
        expiresAt: input.expiresAt ?? '2099-01-01T00:00:00.000Z'
    };
}
export async function makeBrokerCloseFixture(label) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-broker-close-${label}-`));
    const targetRepo = path.join(tempRoot, 'target');
    const planningRepo = path.join(tempRoot, 'planning');
    initGitRepo(targetRepo);
    initGitRepo(planningRepo);
    writeJson(path.join(targetRepo, 'package.json'), { name: `broker-close-${label}`, type: 'module' });
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
    const taskId = `TASK-BROKER-${label.toUpperCase()}`;
    const taskPath = path.join(targetRepo, '.atm/history/tasks', `${taskId}.json`);
    writeJson(taskPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: `${label} broker close fixture`,
        status: 'running',
        deliverables: ['src/app.ts'],
        scopePaths: ['src/app.ts'],
        targetAllowedFiles: ['src/app.ts'],
        validators: [],
        planningRepo: 'planning',
        targetRepo: 'target',
        closureAuthority: 'target_repo',
        source: {
            planPath: `../planning/docs/tasks/${taskId}.task.md`,
            sectionTitle: taskId,
            headingLine: 1,
            hash: 'fixture'
        },
        claim: {
            actorId: 'validator',
            leaseId: `lease-${taskId}`,
            claimedAt: '2026-06-18T00:00:00.000Z',
            heartbeatAt: '2026-06-18T00:00:00.000Z',
            ttlSeconds: 1800,
            files: ['src/app.ts'],
            state: 'active',
            intent: 'write'
        }
    });
    writeText(path.join(targetRepo, 'src/app.ts'), 'export const app = 1;\n');
    writeText(path.join(planningRepo, 'docs/tasks', `${taskId}.task.md`), `---\ntask_id: ${taskId}\nstatus: planned\n---\n`);
    execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base broker close fixture'], { cwd: targetRepo, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base broker close planning fixture'], { cwd: planningRepo, stdio: 'ignore' });
    return { targetRepo, planningRepo, taskId };
}
export async function makeDualRepoCloseFixture(label, options = {}) {
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
    writeJson(path.join(targetRepo, '.atm/history/evidence', `${fixtureTaskId}.closure-packet.json`), {
        schemaId: 'atm.closurePacket.v1',
        taskId: fixtureTaskId
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
