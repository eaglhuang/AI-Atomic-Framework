import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runAtmGit } from '../git-governance.js';
import { CliError, makeResult, message, relativePathFrom } from '../shared.js';
import { resolveActorId } from '../actor-registry.js';
import { parseDeliverAndCloseOptions } from './task-option-parsers.js';
import { readGitScalar } from './task-git-helpers.js';
import { parseClaimRecord } from './task-ledger-readers.js';
import { findActiveBatchRunForTask } from '../work-channels.js';
import { sanitizeTaskDirectionAllowedFiles } from '../task-direction.js';
import { extractTaskCloseDeclaredFiles } from './close-helpers/close-artifact-staging.js';
import { pathMatchesTaskScope } from './historical-delivery.js';
import { normalizeRelativePath, taskPathFor } from './task-file-io-helpers.js';
export async function runTasksDeliverAndClose(argv, dependencies) {
    const options = parseDeliverAndCloseOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks deliver-and-close requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const taskPath = taskPathFor(options.cwd, options.taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
            exitCode: 2,
            details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
        });
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const currentClaim = parseClaimRecord(taskDocument.claim);
    if (!currentClaim || currentClaim.state !== 'active' || currentClaim.actorId !== actorId) {
        throw new CliError('ATM_TASK_DELIVER_AND_CLOSE_CLAIM_REQUIRED', `tasks deliver-and-close requires an active claim on ${options.taskId} owned by ${actorId}.`, {
            exitCode: 1,
            details: {
                taskId: options.taskId,
                actorId,
                claimState: currentClaim?.state ?? null,
                claimActorId: currentClaim?.actorId ?? null,
                requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${options.taskId}" --json`
            }
        });
    }
    if (!options.fromBatchCheckpoint) {
        const owningBatch = findActiveBatchRunForTask(options.cwd, options.taskId);
        if (owningBatch?.status === 'active' && owningBatch.taskIds.includes(options.taskId)) {
            throw new CliError('ATM_BATCH_CHECKPOINT_REQUIRED', `Task ${options.taskId} belongs to active batch ${owningBatch.batchId}. Use batch deliver-and-close instead of tasks deliver-and-close.`, {
                exitCode: 1,
                details: {
                    taskId: options.taskId,
                    batchId: owningBatch.batchId,
                    requiredCommand: `node atm.mjs batch deliver-and-close --actor ${actorId} --batch ${owningBatch.batchId} --json`,
                    skipCommand: `node atm.mjs batch skip --task ${options.taskId} --batch ${owningBatch.batchId} --reason "<blocker>" --actor ${actorId} --json`
                }
            });
        }
    }
    let deliveryCommitSha;
    let autoStagedFiles = [];
    if (options.deliveryCommit) {
        const resolved = readGitScalar(options.cwd, ['rev-parse', '--verify', `${options.deliveryCommit}^{commit}`]);
        if (!resolved) {
            throw new CliError('ATM_COMMIT_NOT_FOUND', `Delivery commit not found in Git: ${options.deliveryCommit}`, {
                exitCode: 1,
                details: { taskId: options.taskId, requestedRef: options.deliveryCommit }
            });
        }
        deliveryCommitSha = resolved;
    }
    else {
        const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument, options.cwd, options.taskId);
        const declaredPaths = sanitizeTaskDirectionAllowedFiles(taskDeclaredFiles);
        const modifiedUnstaged = readGitNameOnly(options.cwd, ['diff', '--name-only']).filter((f) => declaredPaths.length === 0 || declaredPaths.some((d) => pathMatchesTaskScope(f, d)));
        const alreadyStaged = readGitNameOnly(options.cwd, ['diff', '--cached', '--name-only']);
        autoStagedFiles = modifiedUnstaged;
        if (options.dryRun) {
            return makeResult({
                ok: true,
                command: 'tasks',
                cwd: options.cwd,
                messages: [message('info', 'ATM_DELIVER_AND_CLOSE_DRY_RUN', `[dry-run] tasks deliver-and-close for ${options.taskId}: would auto-stage ${modifiedUnstaged.length} file(s) and create delivery commit, then close task as done.`, {
                        taskId: options.taskId,
                        actorId,
                        dryRun: true,
                        wouldAutoStage: modifiedUnstaged,
                        alreadyStaged
                    })],
                evidence: {
                    action: 'deliver-and-close',
                    dryRun: true,
                    taskId: options.taskId,
                    actorId,
                    wouldAutoStage: modifiedUnstaged,
                    alreadyStaged
                }
            });
        }
        if (modifiedUnstaged.length > 0) {
            execFileSync('git', ['-C', options.cwd, 'add', '--', ...modifiedUnstaged], { stdio: 'ignore' });
        }
        const deliveryMessage = options.message ?? `feat: deliver ${options.taskId}`;
        const previousBatchDeliverAndClose = process.env.ATM_BATCH_DELIVER_AND_CLOSE;
        process.env.ATM_BATCH_DELIVER_AND_CLOSE = '1';
        let deliveryResult;
        try {
            deliveryResult = await runAtmGit([
                'commit',
                '--cwd', options.cwd,
                '--actor', actorId,
                '--task', options.taskId,
                '--message', deliveryMessage,
                '--json'
            ]);
        }
        finally {
            if (previousBatchDeliverAndClose == null) {
                delete process.env.ATM_BATCH_DELIVER_AND_CLOSE;
            }
            else {
                process.env.ATM_BATCH_DELIVER_AND_CLOSE = previousBatchDeliverAndClose;
            }
        }
        if (!deliveryResult.ok) {
            throw new CliError('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED', `tasks deliver-and-close: delivery commit failed for ${options.taskId}.`, {
                exitCode: 1,
                details: {
                    taskId: options.taskId,
                    actorId,
                    messages: deliveryResult.messages,
                    remediation: `Stage deliverable changes and re-run: node atm.mjs tasks deliver-and-close --task ${options.taskId} --actor ${actorId} --json`
                }
            });
        }
        deliveryCommitSha = String(deliveryResult.evidence?.commitSha ?? '');
        if (!deliveryCommitSha) {
            throw new CliError('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED', `tasks deliver-and-close: delivery commit succeeded but commitSha was not captured for ${options.taskId}.`, {
                exitCode: 1,
                details: { taskId: options.taskId, actorId }
            });
        }
    }
    const closeArgv = [
        'close',
        '--cwd', options.cwd,
        '--task', options.taskId,
        '--actor', actorId,
        '--status', 'done',
        '--historical-delivery', deliveryCommitSha,
        '--json'
    ];
    if (options.fromBatchCheckpoint) {
        closeArgv.push('--from-batch-checkpoint');
    }
    if (options.batchId) {
        closeArgv.push('--batch', options.batchId);
    }
    if (options.reason) {
        closeArgv.push('--reason', options.reason);
    }
    const closeResult = await dependencies.runTasks(closeArgv);
    if (!closeResult.ok) {
        return makeResult({
            ok: false,
            command: 'tasks',
            cwd: options.cwd,
            messages: [
                message('error', 'ATM_DELIVER_AND_CLOSE_CLOSE_FAILED', `tasks deliver-and-close: close phase failed for ${options.taskId}. Delivery commit ${deliveryCommitSha} was created. Fix the close gate then retry: node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status done --historical-delivery ${deliveryCommitSha} --json`, {
                    taskId: options.taskId,
                    actorId,
                    deliveryCommitSha,
                    retryCloseCommand: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status done --historical-delivery ${deliveryCommitSha} --json`
                }),
                ...closeResult.messages
            ],
            evidence: {
                action: 'deliver-and-close',
                phase: 'close-failed',
                taskId: options.taskId,
                actorId,
                deliveryCommitSha,
                autoStagedFiles,
                closeResult: closeResult.evidence
            }
        });
    }
    const closeEvidence = closeResult.evidence;
    const governanceFiles = [];
    const relTaskPath = typeof closeEvidence.taskPath === 'string' ? closeEvidence.taskPath : relativePathFrom(options.cwd, taskPath);
    if (relTaskPath)
        governanceFiles.push(relTaskPath);
    const evidencePath = `.atm/history/evidence/${options.taskId}.json`;
    if (existsSync(path.resolve(options.cwd, evidencePath)))
        governanceFiles.push(evidencePath);
    if (typeof closeEvidence.closurePacketPath === 'string' && closeEvidence.closurePacketPath) {
        governanceFiles.push(closeEvidence.closurePacketPath);
    }
    if (typeof closeEvidence.transitionPath === 'string' && closeEvidence.transitionPath) {
        governanceFiles.push(closeEvidence.transitionPath);
    }
    const validGovernanceFiles = uniqueStrings(governanceFiles.filter(Boolean));
    if (validGovernanceFiles.length > 0) {
        execFileSync('git', ['-C', options.cwd, 'add', '--', ...validGovernanceFiles], { stdio: ['ignore', 'ignore', 'ignore'] });
    }
    const closureMessage = `chore(${options.taskId}): governance close task with delivery evidence`;
    const closureResult = await runAtmGit([
        'commit',
        '--cwd', options.cwd,
        '--actor', actorId,
        '--task', options.taskId,
        '--message', closureMessage,
        '--json'
    ]);
    const closureCommitSha = closureResult.ok
        ? String(closureResult.evidence?.commitSha ?? '')
        : null;
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DELIVER_AND_CLOSE_OK', `Task ${options.taskId} delivered and closed. Delivery commit: ${deliveryCommitSha}. Governance commit: ${closureCommitSha ?? '(staged but not committed)'}.`, {
                taskId: options.taskId,
                actorId,
                deliveryCommitSha,
                closureCommitSha,
                governanceFiles: validGovernanceFiles
            })
        ],
        evidence: {
            action: 'deliver-and-close',
            taskId: options.taskId,
            actorId,
            deliveryCommitSha,
            closureCommitSha,
            autoStagedFiles,
            governanceFiles: validGovernanceFiles,
            closurePacketPath: typeof closeEvidence.closurePacketPath === 'string' ? closeEvidence.closurePacketPath : null,
            transitionPath: typeof closeEvidence.transitionPath === 'string' ? closeEvidence.transitionPath : null
        }
    });
}
function readGitNameOnly(cwd, args) {
    try {
        const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
    }
    catch {
        return [];
    }
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
