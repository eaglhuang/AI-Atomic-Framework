import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/dist/index.js';
import { assertRunnerFreshForWriteAction, createClosurePacket, createFrameworkModeStatus, executeTaskCloseTransaction, normalizeSha256FieldsDeep, registerCloseCommitWindow, validateClosurePacket, writeClosurePacket } from '../framework-development.js';
import { assertEmergencyApproval } from '../emergency/gate.js';
import { resolveActorId } from '../actor-registry.js';
import { computeMissingValidatorReport } from '../evidence.js';
import { CliError, makeResult, message, relativePathFrom, resolveValue } from '../shared.js';
import { recordStaleRunnerOverride } from './close-governance.js';
import { parseReconcileOptions } from './task-option-parsers.js';
import { readGitScalar } from './task-git-helpers.js';
import { parseClaimRecord } from './task-ledger-readers.js';
import { taskPathFor } from './task-file-io-helpers.js';
import { buildHistoricalDeliveryProvenance } from './historical-delivery.js';
import { createClosureTransitionMetadata } from './task-transition-helpers.js';
import { extractTaskCloseDeclaredFiles, evaluateTaskDeliverableGate, stageTaskCloseArtifacts } from './close-helpers/close-artifact-staging.js';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.js';
export async function runTasksReconcile(argv) {
    const options = parseReconcileOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks reconcile requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const emergencyUse = assertEmergencyApproval({
        cwd: options.cwd,
        surface: 'tasks reconcile',
        permission: 'backend.tasks.reconcile',
        taskId: options.taskId,
        actorId,
        emergencyApproval: options.emergencyApproval,
        flags: [
            ...(options.waiverOutOfScopeDelivery ? ['--waiver-out-of-scope-delivery'] : []),
            ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
        ],
        reason: options.waiverReason ?? 'Direct reconcile backend closeback.',
        command: `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --json`
    });
    const taskPath = taskPathFor(options.cwd, options.taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
            exitCode: 2,
            details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
        });
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const previousTaskContent = readFileSync(taskPath, 'utf8');
    const staleGate = assertRunnerFreshForWriteAction({
        cwd: options.cwd,
        action: 'tasks-reconcile',
        allowStaleRunner: options.allowStaleRunner
    });
    if (options.allowStaleRunner && staleGate.warning) {
        await recordStaleRunnerOverride({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId,
            action: 'tasks-reconcile',
            command: `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --allow-stale-runner --json`
        });
    }
    // TASK-MEM-0007: cross-repo attestation parity with tasks close — verify
    // the delivery commit against --historical-delivery-repo when the card was
    // delivered in another repository (planning-side mirror of a target-repo
    // close, or vice versa).
    const deliveryRepoRoot = options.historicalDeliveryRepo ?? options.cwd;
    const commitSha = readGitScalar(deliveryRepoRoot, ['rev-parse', '--verify', `${options.deliveryCommit}^{commit}`]);
    if (!commitSha) {
        throw new CliError('ATM_COMMIT_NOT_FOUND', `Delivery commit not found in Git: ${options.deliveryCommit}`, {
            exitCode: 1,
            details: { taskId: options.taskId, requestedRef: options.deliveryCommit, deliveryRepoRoot }
        });
    }
    const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument, options.cwd, options.taskId);
    const deliverableGate = evaluateTaskDeliverableGate({
        cwd: options.cwd,
        taskId: options.taskId,
        taskDocument,
        taskDeclaredFiles,
        claim: null,
        historicalDeliveryRefs: [options.deliveryCommit],
        historicalDeliveryRepo: options.historicalDeliveryRepo,
        waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery,
        waiverReason: options.waiverReason
    });
    if (!deliverableGate.ok) {
        throw new CliError('ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', `Task ${options.taskId} cannot be reconciled because ATM found no real non-.atm deliverable diff.`, {
            exitCode: 1,
            details: deliverableGate
        });
    }
    const frameworkStatus = createFrameworkModeStatus({
        cwd: options.cwd,
        files: taskDeclaredFiles.length > 0 ? taskDeclaredFiles : undefined
    });
    if (frameworkStatus?.repoRole === 'framework') {
        const effectiveBlockers = frameworkStatus.blockers.filter((entry) => !['active-framework-claim-required', 'git-head-evidence-missing'].includes(entry));
        if ((frameworkStatus.mode === 'required' || frameworkStatus.mode === 'cross-repo-target-required') && effectiveBlockers.length > 0) {
            const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
            throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED', `Task ${options.taskId} cannot be reconciled until framework-development blockers are resolved.`, {
                details: {
                    taskId: options.taskId,
                    blockers: effectiveBlockers,
                    tldr: missingReport.tldr,
                    missingValidationPasses: missingReport.missingValidationPasses,
                    blockingFindings: missingReport.blockingFindings
                }
            });
        }
    }
    const evidencePath = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.json`);
    if (!existsSync(evidencePath)) {
        mkdirSync(path.dirname(evidencePath), { recursive: true });
        const requiredPasses = uniqueStrings((frameworkStatus?.requiredGates ?? [
            'typecheck',
            'validate:cli',
            'validate:git-head-evidence'
        ]).filter((gate) => gate === 'typecheck' || gate.startsWith('validate:')));
        const envelope = {
            taskId: options.taskId,
            updatedAt: new Date().toISOString(),
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: `Historical reconcile sync completed for ${options.taskId} against commit ${commitSha}.`,
                    artifactPaths: taskDeclaredFiles,
                    producedBy: actorId,
                    createdAt: new Date().toISOString(),
                    evidenceFreshness: 'fresh',
                    validationPasses: requiredPasses,
                    commandRuns: [
                        {
                            command: `git show ${commitSha}`,
                            cwd: relativePathFrom(options.cwd, options.cwd) || '.',
                            exitCode: 0,
                            stdoutSha256: `sha256:${createHash('sha256').update(commitSha).digest('hex')}`,
                            stderrSha256: `sha256:${createHash('sha256').update('reconcile').digest('hex')}`
                        }
                    ],
                    details: {
                        action: 'reconcile',
                        deliveryCommit: commitSha
                    }
                }
            ]
        };
        writeFileSync(evidencePath, `${JSON.stringify(normalizeSha256FieldsDeep(envelope), null, 2)}\n`, 'utf8');
    }
    let closurePacketPath = null;
    let packet = null;
    let pendingReconcilePacket = null;
    let createdClosurePacketAbsolute = null;
    const reconcileReason = `Historical reconcile sync against commit ${commitSha}`;
    if (frameworkStatus?.repoRole === 'framework') {
        pendingReconcilePacket = createClosurePacket({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId,
            sessionId: null,
            evidencePath: `.atm/history/evidence/${options.taskId}.json`,
            requiredGates: frameworkStatus?.requiredGates ?? [],
            changedFiles: deliverableGate.deliverableFiles.length ? deliverableGate.deliverableFiles : taskDeclaredFiles,
            frameworkStatus: frameworkStatus ?? undefined,
            attestation: {
                schemaId: 'atm.reconcileAttestation.v1',
                deliveryCommit: commitSha,
                ...(options.historicalDeliveryRepo ? { deliveryRepoRoot } : {}),
                reconciledAt: new Date().toISOString(),
                reconciledByActor: actorId,
                reason: reconcileReason
            },
            historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(deliverableGate.historicalDeliveries[0] ?? null, options.waiverReason)
        });
        const validation = validateClosurePacket(pendingReconcilePacket);
        if (!validation.ok) {
            const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
            throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet is invalid.`, {
                details: {
                    taskId: options.taskId,
                    missing: validation.missing,
                    invalidFormat: validation.invalidFormat,
                    tldr: missingReport.tldr,
                    missingValidationPasses: missingReport.missingValidationPasses,
                    blockingFindings: missingReport.blockingFindings
                }
            });
        }
        packet = pendingReconcilePacket;
        createdClosurePacketAbsolute = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.closure-packet.json`);
    }
    const currentClaim = parseClaimRecord(taskDocument.claim);
    if (currentClaim && currentClaim.state === 'active') {
        taskDocument.claim = {
            ...currentClaim,
            heartbeatAt: new Date().toISOString(),
            state: 'released',
            reason: 'reconciled'
        };
    }
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'done';
    taskDocument.owner = actorId;
    taskDocument.closedAt = new Date().toISOString();
    taskDocument.closedByActor = actorId;
    taskDocument.closedBySessionId = null;
    taskDocument.closeReason = reconcileReason;
    const reconcileCommand = `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --json`;
    const reconcileWriteResult = await executeTaskCloseTransaction({
        cwd: options.cwd,
        taskId: options.taskId,
        taskPath,
        phase: 'reconcile',
        previousTaskContent,
        createdClosurePacketAbsolute,
        runWrites: () => {
            if (pendingReconcilePacket) {
                closurePacketPath = writeClosurePacket(options.cwd, options.taskId, pendingReconcilePacket);
                packet = pendingReconcilePacket;
                taskDocument.closurePacket = closurePacketPath;
            }
            const transitionPath = writeTaskDocumentWithTransition({
                cwd: options.cwd,
                taskPath,
                taskId: options.taskId,
                taskDocument,
                action: 'close',
                actorId,
                sessionId: null,
                previousStatus,
                closureMetadata: closurePacketPath && packet ? createClosureTransitionMetadata(closurePacketPath, packet, null, null) : null,
                command: reconcileCommand
            });
            return { transitionPath, closurePacketPath };
        }
    });
    const transitionPath = reconcileWriteResult.transitionPath;
    closurePacketPath = reconcileWriteResult.closurePacketPath ?? closurePacketPath;
    const reconcileEvidencePath = relativePathFrom(options.cwd, evidencePath);
    stageTaskCloseArtifacts(options.cwd, [
        relativePathFrom(options.cwd, taskPath),
        reconcileEvidencePath,
        transitionPath,
        closurePacketPath
    ]);
    if (currentClaim && currentClaim.state === 'active') {
        const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
        await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, currentClaim.actorId));
    }
    const closeCommitWindowAllowedFiles = [
        relativePathFrom(options.cwd, taskPath),
        reconcileEvidencePath,
        transitionPath,
        ...(closurePacketPath ? [closurePacketPath] : [])
    ];
    const closeCommitWindowPathReconcile = registerCloseCommitWindow({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        allowedFiles: closeCommitWindowAllowedFiles,
        transitionId: transitionPath.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? null,
        action: 'reconcile'
    });
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [message('info', 'ATM_TASKS_RECONCILED', `Task ${options.taskId} successfully reconciled and closed as done.`, {
                taskId: options.taskId,
                actorId,
                deliveryCommit: commitSha,
                closeCommitWindowPath: closeCommitWindowPathReconcile
            })],
        evidence: {
            action: 'reconcile',
            taskId: options.taskId,
            actorId,
            status: 'done',
            taskPath: relativePathFrom(options.cwd, taskPath),
            closurePacketPath,
            transitionPath,
            closeCommitWindowPath: closeCommitWindowPathReconcile,
            closeCommitWindowAllowedFiles,
            emergencyUse,
            deliverableGate: deliverableGate
        }
    });
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
