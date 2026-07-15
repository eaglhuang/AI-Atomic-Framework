import { collectResolutionAuthorizedForeignTaskIds } from '../broker-conflict-resolution.ts';
import { buildBrokerConflictUxProjection } from '../team.ts';
import { runTasks } from '../tasks/public-surface.ts';
import { CliError } from '../shared.ts';
import { deriveBrokerVerdict, deriveCidVerdict, evaluateClaimAdmission, resolveEffectiveShouldBlockPerCid } from './claim-admission.ts';
import { evaluateBrokerQueueAdmission, type BrokerQueueAdmission } from './broker-queue-admission.ts';
import { buildClaimAdmissionDecisionLog } from './claim-conflict-log.ts';
import type { NextClaimIntent } from './claim-readiness.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';

export async function runClaimParallelPreflight(input: {
  readonly cwd: string;
  readonly claimableTask: ImportedTaskSummary;
  readonly actorId: string;
  readonly claimIntent: NextClaimIntent;
  readonly claimAllowedFiles: readonly string[];
}): Promise<{ readonly parallelAdvisory: Record<string, unknown> | undefined; readonly brokerQueueAdmission: BrokerQueueAdmission | undefined; readonly claimAllowedFiles: readonly string[] }> {
  let parallelAdvisory: Record<string, unknown> | undefined = undefined;
  let brokerQueueAdmission: BrokerQueueAdmission | undefined = undefined;
  let claimAllowedFiles: string[] = input.claimAllowedFiles.slice();
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
            ? finding.overlappingFiles.map((entry: unknown) => String(entry).trim()).filter(Boolean)
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
            const conflictIntent = typeof candidate.activeClaimIntent === 'string' ? candidate.activeClaimIntent : null;
            const activeWriteConflict = Boolean(conflictActorId)
              && conflictActorId !== input.actorId
              && conflictIntent !== 'closeout-only';
            const brokerAdmission = finding.brokerAdmission && typeof finding.brokerAdmission === 'object'
              ? finding.brokerAdmission as { confirmedConflict?: unknown; mutationIntentStatus?: unknown }
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
            const resolutionAuthorizedForeignTaskIds = collectResolutionAuthorizedForeignTaskIds(
              input.cwd,
              input.claimableTask.workItemId
            );
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
              throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                exitCode: 1,
                details: { taskId: input.claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
              });
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
              queuedPrivateWork: queueAdmission.status === 'queued-private-work',
              shouldBlockPerCid: effectiveShouldBlockPerCid
            });
            const admission = evaluateClaimAdmission({
              brokerVerdict,
              cidVerdict,
              candidateTaskId: input.claimableTask.workItemId,
              conflictingTaskId: candidate.taskId,
              overlappingAtomIds
            });
            const admissionReason = admission.admitted
              ? (queueAdmission.status === 'queued-private-work'
                ? 'broker-shared-surface-queue-private-work'
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
                admitted: true,
                admissionReason,
                brokerVerdict,
                cidVerdict,
                claimAdmissionDecisionLog,
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
  } catch (err) {
    if (err instanceof CliError && err.code === 'ATM_NEXT_CLAIM_BLOCKED') {
      throw err;
    }
    // Other parallel errors are handled as best-effort
  }
  return { parallelAdvisory, brokerQueueAdmission, claimAllowedFiles };
}
