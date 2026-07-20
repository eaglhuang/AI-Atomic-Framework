import { spawnSync } from 'node:child_process';
import { collectResolutionAuthorizedForeignTaskIds } from '../broker-conflict-resolution.js';
import { buildBrokerConflictUxProjection } from '../team.js';
import { runTasks } from '../tasks/public-surface.js';
import { CliError } from '../shared.js';
import { compareClaimLifecycleOwners, deriveActiveWriteConflictFromOwnerComparison, deriveBrokerVerdict, deriveCidVerdict, evaluateClaimAdmission, resolveEffectiveShouldBlockPerCid } from './claim-admission.js';
import { evaluateBrokerQueueAdmission } from './broker-queue-admission.js';
import { buildClaimAdmissionDecisionLog } from './claim-conflict-log.js';
import { createProposalLaneAdmission, readActiveProposalLane, writeProposalLane } from './proposal-lane.js';
export async function runClaimParallelPreflight(input) {
    let parallelAdvisory = undefined;
    let brokerQueueAdmission = undefined;
    let proposalLaneAdmission = undefined;
    let claimAllowedFiles = input.claimAllowedFiles.slice();
    try {
        const parallelResult = await runTasks([
            'parallel',
            '--task',
            input.claimableTask.workItemId,
            '--queue',
            '--cwd',
            input.cwd,
            '--json'
        ]);
        if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
            for (const candidate of parallelResult.evidence.candidates) {
                const finding = candidate.finding;
                if (finding) {
                    const overlappingAtomIds = Array.isArray(finding.overlappingAtomIds) ? finding.overlappingAtomIds : [];
                    const overlappingFiles = Array.isArray(finding.overlappingFiles)
                        ? finding.overlappingFiles.map((entry) => String(entry).trim()).filter(Boolean)
                        : [];
                    // Queue admission is driven by concrete writable surfaces, not only
                    // CID overlap. A CID-disjoint same-file finding still needs the
                    // shared file removed from the waiter's direction lock.
                    if (finding.verdict === 'blocked-cid-conflict' || overlappingAtomIds.length > 0 || overlappingFiles.length > 0) {
                        // TASK-CID-0024: same-file / same-atom overlap only blocks the
                        // claim when the overlapping task is actively write-claimed by
                        // another actor. Queued-but-idle overlaps and closeout-only
                        // counterparts are admitted with an advisory so same-file
                        // CID-disjoint parallel work stops being serialized by default.
                        //
                        // TASK-RFT-0011: route the final admission decision through the
                        // `next.claim.admission` policy object so the block-vs-admit call
                        // is unified with `broker register`'s conflict-matrix verdict. The
                        // legacy CID diagnostic is preserved as a wrapper — divergence
                        // (which should not happen) is surfaced as
                        // `ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE` for future
                        // regression detection.
                        const conflictActorId = typeof candidate.activeClaimActorId === 'string' && candidate.activeClaimActorId.trim().length > 0
                            ? candidate.activeClaimActorId
                            : null;
                        const conflictLaneSessionId = normalizeCandidateLaneSessionId(candidate);
                        const currentLaneSessionId = typeof process.env.ATM_LANE_SESSION_ID === 'string' && process.env.ATM_LANE_SESSION_ID.trim()
                            ? process.env.ATM_LANE_SESSION_ID.trim()
                            : null;
                        const ownerComparison = compareClaimLifecycleOwners({
                            current: {
                                actorId: input.actorId,
                                laneSessionId: currentLaneSessionId
                            },
                            conflicting: {
                                actorId: conflictActorId,
                                laneSessionId: conflictLaneSessionId
                            }
                        });
                        const conflictIntent = typeof candidate.activeClaimIntent === 'string' ? candidate.activeClaimIntent : null;
                        const activeWriteConflict = deriveActiveWriteConflictFromOwnerComparison({
                            comparison: ownerComparison,
                            conflictIntent
                        });
                        const brokerAdmission = finding.brokerAdmission && typeof finding.brokerAdmission === 'object'
                            ? finding.brokerAdmission
                            : null;
                        const confirmedBrokerConflict = brokerAdmission?.confirmedConflict === true;
                        const insufficientMutationIntent = finding.verdict === 'insufficient-mutation-intent'
                            || brokerAdmission?.mutationIntentStatus === 'missing';
                        const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
                            claimIntent: input.claimIntent,
                            activeWriteConflict,
                            confirmedBrokerConflict,
                            insufficientMutationIntent,
                            overlappingAtomIdCount: overlappingAtomIds.length
                        });
                        const resolutionAuthorizedForeignTaskIds = collectResolutionAuthorizedForeignTaskIds(input.cwd, input.claimableTask.workItemId);
                        const effectiveShouldBlockPerCid = resolveEffectiveShouldBlockPerCid({
                            shouldBlockPerCid,
                            conflictingTaskId: candidate.taskId,
                            resolutionAuthorizedForeignTaskIds
                        });
                        const queueAdmission = evaluateBrokerQueueAdmission({
                            cwd: input.cwd,
                            taskId: input.claimableTask.workItemId,
                            allowedFiles: claimAllowedFiles,
                            overlappingFiles
                        });
                        if (queueAdmission.status === 'invalid') {
                            throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                                exitCode: 1,
                                details: { taskId: input.claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
                            });
                        }
                        if (queueAdmission.status === 'queued-blocked') {
                            const proposalAdmission = createProposalLaneAdmission({
                                cwd: input.cwd,
                                taskId: input.claimableTask.workItemId,
                                actorId: input.actorId,
                                baseDigest: readGitHeadDigest(input.cwd),
                                overlappingFiles,
                                queueAdmission,
                                existingLane: readActiveProposalLane(input.cwd, input.claimableTask.workItemId)
                            });
                            if (proposalAdmission.status === 'same-task-conflict') {
                                throw new CliError('ATM_LOCK_CONFLICT', proposalAdmission.reason, {
                                    exitCode: 1,
                                    details: { taskId: input.claimableTask.workItemId, brokerQueueAdmission: queueAdmission, proposalLaneAdmission: proposalAdmission }
                                });
                            }
                            if (!proposalAdmission.proposalLane) {
                                throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                                    exitCode: 1,
                                    details: { taskId: input.claimableTask.workItemId, brokerQueueAdmission: queueAdmission, proposalLaneAdmission: proposalAdmission }
                                });
                            }
                            writeProposalLane(input.cwd, proposalAdmission.proposalLane);
                            proposalLaneAdmission = proposalAdmission;
                            brokerQueueAdmission = queueAdmission;
                            claimAllowedFiles = proposalAdmission.allowedPrivatePaths.slice();
                        }
                        if (queueAdmission.status === 'queued-private-work') {
                            brokerQueueAdmission = queueAdmission;
                            claimAllowedFiles = queueAdmission.allowedFiles.slice();
                        }
                        const sharedConflictSurfaces = overlappingFiles.length > 0
                            ? overlappingFiles
                            : (overlappingAtomIds.length > 0 ? overlappingAtomIds : ['<shared-path>']);
                        const decisionClass = insufficientMutationIntent ? 'blocked' : 'serial-release';
                        const decisionReason = insufficientMutationIntent
                            ? 'broker-conflict-blocked because active task overlap lacks a confirmed Broker mutation intent or resolution artifact.'
                            : 'broker-conflict-blocked because the Broker confirmed an active task ownership conflict.';
                        const requiredCommand = `node atm.mjs team broker resolve --task ${input.claimableTask.workItemId} --conflict ${candidate.taskId} --path ${sharedConflictSurfaces[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
                        const conflictUx = buildBrokerConflictUxProjection({
                            primaryTaskId: input.claimableTask.workItemId,
                            conflictingTaskIds: [candidate.taskId],
                            sharedPaths: overlappingFiles,
                            overlappingAtomIds,
                            decisionClass,
                            decisionReason,
                            violationStatus: 'broker-conflict-blocked',
                            statusCode: 'broker-conflict-blocked',
                            blockedTaskIds: [candidate.taskId],
                            requiredCommand
                        });
                        // Broker verdict derivation: the parallel-preflight is itself the
                        // broker-authoritative arbitration for this claim path. `blocked`
                        // maps to broker `freeze`; anything else the CID gate would admit
                        // maps to broker `allow`. When broker's separate authoritative
                        // registry adds a distinct verdict feed here in a follow-up, the
                        // divergence detector will start firing.
                        const brokerVerdict = deriveBrokerVerdict({
                            queuedPrivateWork: queueAdmission.status === 'queued-private-work' || proposalLaneAdmission?.status === 'proposal-lane-opened',
                            shouldBlockPerCid: proposalLaneAdmission?.status === 'proposal-lane-opened' ? false : effectiveShouldBlockPerCid
                        });
                        const admission = evaluateClaimAdmission({
                            brokerVerdict,
                            cidVerdict,
                            candidateTaskId: input.claimableTask.workItemId,
                            conflictingTaskId: candidate.taskId,
                            overlappingAtomIds,
                            ownerComparison
                        });
                        const admissionReason = admission.admitted
                            ? (queueAdmission.status === 'queued-private-work'
                                ? 'broker-shared-surface-queue-private-work'
                                : proposalLaneAdmission?.status === 'proposal-lane-opened'
                                    ? 'broker-isolated-proposal-lane'
                                    : insufficientMutationIntent
                                        ? 'broker-conflict-not-confirmed'
                                        : input.claimIntent === 'closeout-only'
                                            ? 'closeout-only-claim-intent'
                                            : 'cid-overlap-without-active-write-claim')
                            : null;
                        const claimAdmissionDecisionLog = buildClaimAdmissionDecisionLog({
                            taskId: input.claimableTask.workItemId,
                            conflictTaskId: candidate.taskId,
                            claimIntent: input.claimIntent,
                            activeWriteConflict,
                            confirmedBrokerConflict,
                            insufficientMutationIntent,
                            cidVerdict,
                            brokerVerdict,
                            queueAdmission,
                            overlappingFiles,
                            decision: admission,
                            ownerComparison,
                            admissionReason
                        });
                        if (!admission.admitted) {
                            throw new CliError(admission.blockCode ?? 'ATM_NEXT_CLAIM_BLOCKED', admission.blockReason
                                ?? `Claim blocked due to parallel CID logic conflict with actively claimed task ${candidate.taskId} on atom(s): ${overlappingAtomIds.join(', ')}.`, {
                                exitCode: 1,
                                details: {
                                    taskId: input.claimableTask.workItemId,
                                    conflictWithTaskId: candidate.taskId,
                                    conflictClaimActorId: conflictActorId,
                                    conflictClaimLaneSessionId: conflictLaneSessionId,
                                    currentActorId: input.actorId,
                                    currentLaneSessionId,
                                    ownerComparisonMode: ownerComparison.mode,
                                    blockedTaskIds: conflictUx.blockedTaskIds,
                                    sharedPaths: conflictUx.sharedPaths,
                                    overlappingAtomIds,
                                    verdict: 'blocked-cid-conflict',
                                    brokerVerdict,
                                    cidVerdict,
                                    decisionClass,
                                    decisionReason,
                                    violationStatus: 'broker-conflict-blocked',
                                    statusCode: 'broker-conflict-blocked',
                                    requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
                                    requiredCommand,
                                    conflictUx,
                                    claimAdmissionDecisionLog,
                                    admissionDivergence: admission.divergence,
                                    closeoutOnlyHint: `If ${input.claimableTask.workItemId} already delivered its scoped files and only needs governed closeout, rerun next --claim with --claim-intent closeout-only.`
                                }
                            });
                        }
                        if (!parallelAdvisory) {
                            parallelAdvisory = {
                                ...finding,
                                verdict: insufficientMutationIntent
                                    ? 'insufficient-mutation-intent'
                                    : 'parallel-safe-with-cid-overlap-advisory',
                                conflictWithTaskId: candidate.taskId,
                                conflictClaimActorId: conflictActorId,
                                conflictClaimLaneSessionId: conflictLaneSessionId,
                                currentActorId: input.actorId,
                                currentLaneSessionId,
                                ownerComparisonMode: ownerComparison.mode,
                                admitted: true,
                                admissionReason,
                                brokerVerdict,
                                cidVerdict,
                                claimAdmissionDecisionLog,
                                ...(proposalLaneAdmission ? { proposalLaneAdmission } : {}),
                                ...(admission.divergence ? { admissionDivergence: admission.divergence } : {})
                            };
                        }
                        continue;
                    }
                    if (overlappingAtomIds.length > 0 && !parallelAdvisory) {
                        parallelAdvisory = {
                            ...finding,
                            verdict: finding.verdict ?? 'insufficient-mutation-intent',
                            conflictWithTaskId: candidate.taskId,
                            admitted: true,
                            admissionReason: 'broker-conflict-not-confirmed'
                        };
                        continue;
                    }
                    if (finding.verdict !== 'parallel-safe' && !parallelAdvisory) {
                        parallelAdvisory = finding;
                    }
                }
            }
        }
    }
    catch (err) {
        if (err instanceof CliError && err.code === 'ATM_NEXT_CLAIM_BLOCKED') {
            throw err;
        }
        // Other parallel errors are handled as best-effort
    }
    return { parallelAdvisory, brokerQueueAdmission, proposalLaneAdmission, claimAllowedFiles };
}
function normalizeCandidateLaneSessionId(candidate) {
    const direct = normalizeString(candidate.activeClaimLaneSessionId)
        ?? normalizeString(candidate.activeClaimLaneId)
        ?? normalizeString(candidate.laneSessionId)
        ?? normalizeString(candidate.guidanceSessionId);
    if (direct)
        return direct;
    const activeClaim = candidate.activeClaim && typeof candidate.activeClaim === 'object' && !Array.isArray(candidate.activeClaim)
        ? candidate.activeClaim
        : null;
    const claimLane = activeClaim?.laneSession && typeof activeClaim.laneSession === 'object' && !Array.isArray(activeClaim.laneSession)
        ? activeClaim.laneSession
        : null;
    return normalizeString(claimLane?.laneSessionId) ?? normalizeString(claimLane?.laneId);
}
function normalizeString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readGitHeadDigest(cwd) {
    const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : 'unresolved-head';
}
