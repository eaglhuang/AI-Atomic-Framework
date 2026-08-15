// @ts-nocheck
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CliError, makeResult, message } from '../shared.ts';
import {
  loadRegistry,
  saveRegistry,
  registerIntent,
  renewIntentLease,
  releaseTask,
  cleanupStale
} from '../../../../core/src/broker/registry.ts';
import { cleanupBrokerRuntimeSnapshots } from '../../../../core/src/broker/lifecycle.ts';
import { calculateBrokerDecision } from '../../../../core/src/broker/decision.ts';
import { composeBrokerProposals } from '../../../../core/src/broker/compose.ts';
import { applyStewardPlan, executeBrokerScopedWrite, planStewardApply } from '../../../../core/src/broker/steward.ts';
import { buildTeamBrokerRuntimeActivationHandshake, buildTeamBrokerRunRecord, buildTeamBrokerRunRecordEnvelope, projectTeamBrokerRearbitrationSnapshot } from '../../../../core/src/broker/team-lane.ts';
import { defaultBrokerProposalStoreRelativePath, findBrokerProposal, listBrokerProposalSummaries, loadBrokerProposalStore, readBrokerProposalFile, saveBrokerProposalStore, upsertBrokerProposalStore, validateBrokerProposal } from '../../../../core/src/broker/proposal.ts';
import { defaultAdapterRegistry, resolveAdapter } from '../../../../core/src/broker/adapters/registry.ts';
import { planMutationBatch } from '../../../../core/src/broker/adapters/batch-planner.ts';
import { computeCasResult, hashContent } from '../../../../core/src/broker/adapters/cas.ts';
import { enqueueSharedSurface, planSharedSurfaceAcquisition, removeSharedSurfaceEntry, type SharedSurfaceQueue } from '../../../../core/src/broker/shared-surface-queue.ts';
import { cleanupRunnerSyncStewardQueue, emptyRunnerSyncStewardQueue, enqueueRunnerSyncStewardRequest, explainRunnerSyncStewardPosition, releaseRunnerSyncStewardQueue, type RunnerSyncStewardQueueDocument, type RunnerSyncTaskHealth, type RunnerSyncStewardRequest } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { resolveRunnerSyncLeaseHealth } from '../framework-development/runner-sync-lease-health.ts';
import { supersedeRunnerSyncReservation } from './runner-sync-supersession.ts';
import { cleanupGeneratedProjectionSteward, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, type GeneratedProjectionStewardDocument } from '../../../../core/src/broker/generated-projection-steward.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, type FreezeAck, type FreezeResolution, type FreezeSignal } from '../../../../core/src/broker/freeze.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord, ExplicitMutationIntentInputSummary, ExplicitMutationIntentKind, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';
import { appendLaneSessionEvent } from '../lane-session/events.ts';
import { evaluateRunnerPublicationContinuation, inspectRunnerPublicationDisposition, reconcileReceiptOnlyRunnerPublicationResidue } from '../framework-development/runner-publication-lifecycle.ts';
import { runRunnerSyncTakeoverPublication } from './publication-takeover-admission.ts';


export function handleBrokerStewardQueues(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  const runnerSyncQueuePath = context.runnerSyncQueuePath;
  const projectionStewardPath = context.projectionStewardPath;
  if (options.action === 'runner-sync') {
    if (options.runnerSyncAction === 'enqueue' || options.runnerSyncAction === 'supersede') {
      const action = options.runnerSyncAction;
      if (!options.task) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --task <task-id>.', { exitCode: 2 });
      }
      if (!options.actorId) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --actor <actor-id>.', { exitCode: 2 });
      }
      if (!options.sealedSourceSha) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --sealed-source-sha <sha>.', { exitCode: 2 });
      }
      if (options.surfaces.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires at least one --surface <path>.', { exitCode: 2 });
      }
      let result;
      try {
        result = (action === 'supersede' ? supersedeRunnerSyncReservation : enqueueRunnerSyncStewardRequest)(readRunnerSyncStewardQueue(runnerSyncQueuePath), {
          taskId: options.task,
          actorId: options.actorId,
          sealedSourceSha: resolveFullGitCommitSha(options.cwd, options.sealedSourceSha),
          requestedSurfaces: options.surfaces,
          ttlSeconds: options.ttlSeconds
        }, {
          taskHealthResolver: (taskId) => resolveRunnerSyncTaskIdHealth(options.cwd, taskId)
        });
      } catch (error) {
        throw toRunnerSyncQueueCliError(error);
      }
      writeRunnerSyncStewardQueue(runnerSyncQueuePath, result.queue);
      const laneEvent = appendBrokerTicketLaneEvent(options.cwd, options.actorId, result.brokerTicket);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', action === 'supersede' ? 'ATM_BROKER_RUNNER_SYNC_SUPERSEDED' : 'ATM_BROKER_RUNNER_SYNC_ENQUEUED', action === 'supersede' ? `Runner-sync reservation superseded ${result.supersededReservations.length} incompatible generation(s); new request is ${result.status} at position ${result.queuePosition}.` : `Runner-sync request is ${result.status} at position ${result.queuePosition} for steward work ${result.stewardWorkId}.`, {
            status: result.status,
            queuePosition: result.queuePosition,
            queueHeadHealth: result.queueHeadHealth,
            stewardWorkId: result.stewardWorkId,
            waitingTasks: result.waitingTasks,
            brokerTicket: result.brokerTicket,
            suggestedNextAction: result.suggestedNextAction,
            supersededReservations: result.supersededReservations ?? []
          })
        ],
        evidence: {
          runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
          runnerSync: result,
          brokerTicket: result.brokerTicket,
          laneSessionEvent: laneEvent
        }
      });
    }

    if (options.runnerSyncAction === 'status') {
      const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
      const position = options.task
        ? explainRunnerSyncStewardPosition(queue, options.task, new Date().toISOString(), {
          taskHealthResolver: (request) => resolveRunnerSyncTaskHealth(options.cwd, request)
        })
        : null;
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_RUNNER_SYNC_STATUS', `Runner-sync steward queue contains ${queue.groups.length} steward work item(s).`)
        ],
        evidence: {
          runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
          queue,
          position
        }
      });
    }

    if (options.runnerSyncAction === 'cleanup') {
      const cleanup = cleanupRunnerSyncStewardQueue(
        readRunnerSyncStewardQueue(runnerSyncQueuePath),
        new Date().toISOString(),
        {
          taskHealthResolver: (request) => resolveRunnerSyncTaskHealth(options.cwd, request)
        }
      );
      writeRunnerSyncStewardQueue(runnerSyncQueuePath, cleanup.queue);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_RUNNER_SYNC_CLEANUP', `Runner-sync steward cleanup released ${cleanup.staleReleases.length} stale request(s).`, {
            staleReleases: cleanup.staleReleases
          })
        ],
        evidence: {
          runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
          cleanup
        }
      });
    }

    if (options.runnerSyncAction === 'release') {
      if (!options.task) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync release requires --task <task-id>.', { exitCode: 2 });
      }
      if (!options.stewardWorkId) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync release requires --steward-work-id <id>.', { exitCode: 2 });
      }
      try {
        const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
        const receipt = validateRunnerSyncReleaseReceipt({
          cwd: options.cwd,
          queue,
          taskId: options.task,
          stewardWorkId: options.stewardWorkId,
          receiptRef: options.receiptRef,
          receiptDigest: options.receiptDigest
        });
        const release = releaseRunnerSyncStewardQueue(queue, {
          taskId: options.task,
          stewardWorkId: options.stewardWorkId,
          receiptRef: receipt.receiptRef,
          receiptDigest: receipt.receiptDigest
        });
        writeRunnerSyncStewardQueue(runnerSyncQueuePath, release.queue);
        return makeResult({
          ok: true,
          command: 'broker',
          cwd: options.cwd,
          messages: [
            message('info', 'ATM_BROKER_RUNNER_SYNC_RELEASED', `Runner-sync steward work ${release.released.stewardWorkId} released for ${release.released.waitingTasks.length} waiting task(s).`, {
              stewardWorkId: release.released.stewardWorkId,
              waitingTasks: release.released.waitingTasks,
              nextStewardWorkId: release.next?.stewardWorkId ?? null,
              suggestedNextAction: release.suggestedNextAction
            })
          ],
          evidence: {
            runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
            release
          }
        });
      } catch (error) {
        throw toRunnerSyncReleaseCliError(error);
      }
    }

    if (options.runnerSyncAction === 'reconcile-receipt') {
      if (!options.task || !options.actorId || !options.receiptRef) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync reconcile-receipt requires --task <task-id>, --actor <actor-id>, and --receipt-ref <path>.', { exitCode: 2 });
      }
      assertRunnerSyncRecoveryAuthority(options.cwd, options.task, options.actorId);
      try {
        const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
        const reconciliation = reconcileReceiptOnlyRunnerPublicationResidue({
          cwd: options.cwd,
          taskId: options.task,
          actorId: options.actorId,
          receiptRef: options.receiptRef,
          activeStewardWorkIds: queue.groups.map((group) => group.stewardWorkId)
        });
        return makeResult({
          ok: true,
          command: 'broker',
          cwd: options.cwd,
          messages: [
            message(
              'info',
              'ATM_BROKER_RUNNER_SYNC_RECEIPT_RECONCILED',
              reconciliation.decision === 'deleted-untracked-orphan'
                ? `Deleted the verified untracked orphan runner receipt ${reconciliation.legacyReceiptPath} through the receipt-only recovery route.`
                : `Restored the verified stale runner receipt ${reconciliation.legacyReceiptPath} through the receipt-only recovery route.`,
              reconciliation
            )
          ],
          evidence: {
            runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
            reconciliation,
            recoveryReceiptPath: `.atm/history/evidence/${options.task}.runner-publication-recovery.json`
          }
        });
      } catch (error) {
        throw toRunnerSyncQueueCliError(error);
      }
    }

    if (options.runnerSyncAction === 'takeover-publication') {
      if (!options.task || !options.actorId || !options.sealedSourceSha || options.surfaces.length !== 1) {
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync takeover-publication requires --task, --actor, --sealed-source-sha, and exactly one --surface <full|packages|root-drop|onefile>.', { exitCode: 2 });
      }
      const currentTaskAllowedFiles = assertRunnerSyncRecoveryAuthority(options.cwd, options.task, options.actorId);
      const buildTarget = options.surfaces[0];
      if (!['full', 'packages', 'root-drop', 'onefile'].includes(buildTarget)) {
        throw new CliError('ATM_CLI_USAGE', 'takeover-publication surface must be one of: full, packages, root-drop, onefile.', { exitCode: 2 });
      }
      return runRunnerSyncTakeoverPublication({
        cwd: options.cwd,
        taskId: options.task,
        sealedSourceSha: resolveFullGitCommitSha(options.cwd, options.sealedSourceSha),
        currentHeadSha: resolveFullGitCommitSha(options.cwd, 'HEAD'),
        surface: buildTarget,
        queue: readRunnerSyncStewardQueue(runnerSyncQueuePath),
        currentTaskAllowedFiles
      });
    }

    throw new CliError('ATM_CLI_USAGE', 'broker runner-sync supports: enqueue, supersede, status, cleanup, release, reconcile-receipt, takeover-publication', { exitCode: 2 });
  }

  if (options.action === 'projection') {
    if (options.projectionAction === 'enqueue') {
      if (!options.task) {
        throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --task <task-id>.', { exitCode: 2 });
      }
      if (!options.actorId) {
        throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --actor <actor-id>.', { exitCode: 2 });
      }
      if (!options.projectionKey) {
        throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --projection-key <key>.', { exitCode: 2 });
      }
      if (options.sourceItems.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires at least one --source-item <path>.', { exitCode: 2 });
      }
      const result = enqueueGeneratedProjectionRebuild(readGeneratedProjectionSteward(projectionStewardPath), {
        taskId: options.task,
        actorId: options.actorId,
        projectionKey: options.projectionKey,
        sourceItemPaths: options.sourceItems,
        ttlSeconds: options.ttlSeconds
      });
      writeGeneratedProjectionSteward(projectionStewardPath, result.queue);
      const laneEvent = appendBrokerTicketLaneEvent(options.cwd, options.actorId, result.brokerTicket);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_PROJECTION_ENQUEUED', `Generated projection rebuild for ${result.projectionKey} is at position ${result.queuePosition}; owner is ${result.ownerTaskId}.`, {
            projectionKey: result.projectionKey,
            ownerTaskId: result.ownerTaskId,
            queuePosition: result.queuePosition,
            brokerTicket: result.brokerTicket,
            suggestedNextAction: result.suggestedNextAction
          })
        ],
        evidence: {
          generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
          projection: result,
          brokerTicket: result.brokerTicket,
          laneSessionEvent: laneEvent
        }
      });
    }

    if (options.projectionAction === 'status') {
      const queue = readGeneratedProjectionSteward(projectionStewardPath);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_PROJECTION_STATUS', `Generated projection steward contains ${queue.queues.length} projection queue(s).`)
        ],
        evidence: {
          generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
          queue
        }
      });
    }

    if (options.projectionAction === 'cleanup') {
      const cleanup = cleanupGeneratedProjectionSteward(readGeneratedProjectionSteward(projectionStewardPath));
      writeGeneratedProjectionSteward(projectionStewardPath, cleanup.queue);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_PROJECTION_CLEANUP', `Generated projection steward cleanup released ${cleanup.staleReleases.length} stale request(s).`, {
            staleReleases: cleanup.staleReleases
          })
        ],
        evidence: {
          generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
          cleanup
        }
      });
    }

    throw new CliError('ATM_CLI_USAGE', 'broker projection supports: enqueue, status, cleanup', { exitCode: 2 });
  }

  return null;
}

function appendBrokerTicketLaneEvent(cwd: string, actorId: string | null | undefined, brokerTicket: Record<string, unknown>) {
  const laneId = process.env.ATM_LANE_SESSION_ID?.trim();
  if (!laneId) return null;
  try {
    return appendLaneSessionEvent({
      cwd,
      laneId,
      action: 'broker-ticket-enqueued',
      actorId: actorId ?? null,
      details: { brokerTicket }
    });
  } catch {
    return null;
  }
}

function resolveRunnerSyncTaskHealth(cwd: string, request: RunnerSyncStewardRequest): RunnerSyncTaskHealth {
  return resolveRunnerSyncTaskIdHealth(cwd, request.taskId);
}

function resolveRunnerSyncTaskIdHealth(cwd: string, taskId: string): RunnerSyncTaskHealth {
  return resolveRunnerSyncLeaseHealth(cwd, taskId);
}

function assertRunnerSyncRecoveryAuthority(cwd: string, taskId: string, actorId: string): readonly string[] {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) {
    const health = resolveFrameworkTempRunnerSyncTaskHealth(cwd, taskId);
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    if (health !== 'task-active' || !existsSync(lockPath)) {
      throw new CliError('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE', `Recovery task ${taskId} has neither an active task claim nor an active framework-temp claim.`, { exitCode: 1 });
    }
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const lockActor = String(lock.actorId ?? lock.lockedBy ?? '').trim();
      if (lockActor !== actorId) {
        throw new CliError('ATM_RUNNER_PUBLICATION_PENDING', `Framework-temp publication recovery for ${taskId} is held by ${lockActor || 'another actor'}, not ${actorId}.`, { exitCode: 1 });
      }
      return Array.isArray(lock.files) ? lock.files.map(String) : [];
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE', `Framework-temp recovery claim ${taskId} could not be read.`, { exitCode: 1 });
    }
  }
  try {
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const claim = task.claim && typeof task.claim === 'object' ? task.claim as Record<string, unknown> : null;
    if (task.status !== 'running' || claim?.state !== 'active' || claim.actorId !== actorId) {
      throw new CliError('ATM_RUNNER_PUBLICATION_PENDING', `Receipt-only reconciliation requires an active claim for ${taskId} held by ${actorId}.`, { exitCode: 1 });
    }
    return Array.isArray(task.allowedFiles) ? task.allowedFiles.map(String) : [];
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE', `Recovery task ${taskId} could not be read.`, { exitCode: 1 });
  }
}

function resolveFrameworkTempRunnerSyncTaskHealth(cwd: string, taskId: string): RunnerSyncTaskHealth | null {
  const normalizedTaskId = String(taskId ?? '').trim();
  if (!normalizedTaskId.startsWith('ATM-FRAMEWORK-TEMP-')) {
    return null;
  }
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${normalizedTaskId}.lock.json`);
  if (!existsSync(lockPath)) {
    return 'task-missing';
  }
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const workItemId = typeof lock.workItemId === 'string' ? lock.workItemId.trim() : '';
    const leaseId = typeof lock.leaseId === 'string' ? lock.leaseId.trim() : '';
    const heartbeatAt = typeof lock.heartbeatAt === 'string' ? lock.heartbeatAt : null;
    const released = lock.released === true || String(lock.status ?? '').trim().toLowerCase() === 'released';
    const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds)
      ? lock.ttlSeconds
      : 0;
    if (workItemId !== normalizedTaskId || !leaseId || !heartbeatAt || ttlSeconds <= 0) {
      return 'task-missing';
    }
    if (released) return 'task-terminal';
    const heartbeatMs = Date.parse(heartbeatAt);
    return Number.isFinite(heartbeatMs) && heartbeatMs + ttlSeconds * 1000 > Date.now()
      ? 'task-active'
      : 'task-lease-expired';
  } catch {
    return 'task-missing';
  }
}

function resolveFullGitCommitSha(cwd: string, value: string): string {
  const raw = String(value ?? '').trim();
  try {
    return execFileSync('git', ['rev-parse', '--verify', raw], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return raw;
  }
}

export function validateRunnerSyncReleaseReceipt(input: {
  cwd: string;
  queue: RunnerSyncStewardQueueDocument;
  taskId: string;
  stewardWorkId: string;
  receiptRef: string | null;
  receiptDigest: string | null;
}): { receiptRef: string; receiptDigest: string } {
  const receiptRef = String(input.receiptRef ?? '').trim();
  if (!receiptRef) {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_REQUIRED: release requires --receipt-ref pointing at an atm.runnerSyncReceipt.v1 evidence file.');
  }
  const absoluteReceipt = path.resolve(input.cwd, receiptRef);
  if (!absoluteReceipt.startsWith(path.resolve(input.cwd) + path.sep)) {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt reference must stay inside the repository.');
  }
  if (!existsSync(absoluteReceipt)) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt file does not exist: ${receiptRef}.`);
  }
  const raw = readFileSync(absoluteReceipt, 'utf8');
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const expectedDigest = String(input.receiptDigest ?? '').trim();
  if (expectedDigest && expectedDigest !== digest) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_DIGEST_MISMATCH: receipt digest ${digest} does not match ${expectedDigest}.`);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt is not valid JSON.');
  }

  const group = input.queue.groups.find((candidate) => candidate.stewardWorkId === input.stewardWorkId);
  if (!group) {
    throw new Error(`ATM_RUNNER_SYNC_RESUME_REQUIRED: steward work ${input.stewardWorkId} is not queued; do not trust an orphan autoReleaseCommand. Run node atm.mjs broker runner-sync status --json, then re-enqueue/reconcile the steward session before release.`);
  }
  const ownerRequest = group.requests.find((request) => request.taskId === input.taskId);
  if (!ownerRequest) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_OWNER_MISMATCH: task ${input.taskId} is not waiting on ${input.stewardWorkId}.`);
  }
  const receiptSurfaces = normalizeReceiptStringArray(receipt.requestedSurfaces);
  const expectedSurfaces = normalizeReceiptStringArray(group.requestedSurfaces);
  const mismatches = [
    receipt.schemaId === 'atm.runnerSyncReceipt.v1' ? null : 'schemaId',
    receiptRepresentsRunnerSyncQueueTask(receipt, input.taskId) ? null : 'taskId',
    receipt.actorId === ownerRequest.actorId ? null : 'actorId',
    receipt.stewardWorkId === input.stewardWorkId ? null : 'stewardWorkId',
    receipt.sealedSourceSha === group.sealedSourceSha ? null : 'sealedSourceSha',
    arraysEqual(receiptSurfaces, expectedSurfaces) ? null : 'requestedSurfaces'
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt does not match queued runner-sync steward fields: ${mismatches.join(', ')}.`);
  }
  // Release is receipt-addressed; never let a different dirty temporary
  // receipt replace the queue-head receipt during publication validation.
  const publication = inspectRunnerPublicationDisposition(input.cwd, receiptRef);
  if (!publication.ok && publication.code) {
    throw new Error(`${publication.code}: receipt ${receiptRef} cannot release ${input.stewardWorkId} while its sealed output inventory is ${publication.report.disposition}. inventoryDigest=${publication.report.inventoryDigest}.`);
  }
  const continuation = evaluateRunnerPublicationContinuation({
    taskId: input.taskId,
    queueMemberTaskIds: group.waitingTasks,
    stewardWorkId: input.stewardWorkId,
    queueHeadStewardWorkId: group.queuePosition === 1 ? group.stewardWorkId : '',
    sealedSourceSha: group.sealedSourceSha,
    receiptSealedSourceSha: String(receipt.sealedSourceSha ?? ''),
    receiptDigest: digest,
    inventoryDigest: publication.report.inventoryDigest,
    receiptInventoryDigest: String((receipt.outputInventory as Record<string, unknown> | undefined)?.digest ?? ''),
  });
  if (!continuation.allowed) {
    throw new Error(`${continuation.code}: ${continuation.reason}`);
  }
  validateRunnerSyncReleaseFinalizableReceipt({ receipt, group, stewardWorkId: input.stewardWorkId });
  return {
    receiptRef: receiptRef.replace(/\\/g, '/'),
    receiptDigest: digest
  };
}

function receiptRepresentsRunnerSyncQueueTask(receipt: Record<string, unknown>, queueTaskId: string): boolean {
  const receiptTaskId = typeof receipt.taskId === 'string' ? receipt.taskId.trim() : '';
  if (!receiptTaskId) return false;
  if (receiptTaskId === queueTaskId) return true;

  const memberTaskIds = normalizeReceiptStringArray(receipt.memberTaskIds);
  const linkedTaskIds = normalizeReceiptStringArray(receipt.linkedTaskIds);
  return memberTaskIds.includes(queueTaskId) && linkedTaskIds.includes(receiptTaskId);
}

function validateRunnerSyncReleaseFinalizableReceipt(input: {
  receipt: Record<string, unknown>;
  group: RunnerSyncStewardQueueDocument['groups'][number];
  stewardWorkId: string;
}): void {
  const receipt = input.receipt;
  const expectedMembers = normalizeReceiptStringArray(input.group.waitingTasks);
  const memberTaskIds = normalizeReceiptStringArray(receipt.memberTaskIds);
  const lifecycle = isRecord(receipt.lifecycle) ? receipt.lifecycle : {};
  const childAttribution = isRecord(receipt.childAttribution) ? receipt.childAttribution : {};
  const childReceipts = Array.isArray(receipt.childReceipts) ? receipt.childReceipts : [];
  const groupManifest = isRecord(receipt.groupManifest) ? receipt.groupManifest : {};
  const runnerInputGraph = isRecord(receipt.runnerInputGraph) ? receipt.runnerInputGraph : {};
  const manifestMembers = normalizeReceiptStringArray(groupManifest.memberTaskIds);
  const runnerInputTreeHash = typeof receipt.runnerInputTreeHash === 'string' ? receipt.runnerInputTreeHash : '';
  const missingFields = [
    memberTaskIds.length > 0 ? null : 'memberTaskIds',
    childReceipts.length > 0 || childAttribution.complete === true ? null : 'childReceipts/childAttribution',
    runnerInputTreeHash ? null : 'runnerInputTreeHash',
    Object.keys(runnerInputGraph).length > 0 ? null : 'runnerInputGraph',
    lifecycle.provisionalState === 'built-provisional' ? null : 'lifecycle.provisionalState',
    lifecycle.publicationReadyState === 'publication-ready' ? null : 'lifecycle.publicationReadyState',
    lifecycle.reconcilePhase === 'reconciled' ? null : 'lifecycle.reconcilePhase',
    lifecycle.finalizable === true ? null : 'lifecycle.finalizable'
  ].filter(Boolean);
  if (missingFields.length > 0) {
    throw new Error(`ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING: runner-sync receipt for ${input.stewardWorkId} is not finalizable (${missingFields.join(', ')}). Run ${resumeRunnerSyncCommand(input.stewardWorkId, String(receipt.sealedSourceSha ?? input.group.sealedSourceSha))}.`);
  }
  if (!arraysEqual(memberTaskIds, expectedMembers) || !arraysEqual(manifestMembers, expectedMembers)) {
    throw new Error(`ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING: runner-sync receipt member attribution does not match queued group. expected=${expectedMembers.join(',')} receipt=${memberTaskIds.join(',')}. Run ${resumeRunnerSyncCommand(input.stewardWorkId, String(receipt.sealedSourceSha ?? input.group.sealedSourceSha))}.`);
  }
  const receiptTasks = normalizeReceiptStringArray(childReceipts.map((entry) => isRecord(entry) ? entry.taskId : null));
  if (!arraysEqual(receiptTasks, expectedMembers)) {
    throw new Error(`ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING: runner-sync child receipts do not cover every queued member. expected=${expectedMembers.join(',')} childReceipts=${receiptTasks.join(',')}. Run ${resumeRunnerSyncCommand(input.stewardWorkId, String(receipt.sealedSourceSha ?? input.group.sealedSourceSha))}.`);
  }
  const graphSeal = typeof runnerInputGraph.sealedSourceSha === 'string' ? runnerInputGraph.sealedSourceSha : '';
  const graphTreeHash = typeof runnerInputGraph.aggregateInputTreeHash === 'string' ? runnerInputGraph.aggregateInputTreeHash : '';
  if (graphSeal !== receipt.sealedSourceSha || graphSeal !== input.group.sealedSourceSha || graphTreeHash !== runnerInputTreeHash) {
    throw new Error(`ATM_RUNNER_SYNC_SEAL_CONTINUITY_MISMATCH: runner-sync receipt seal continuity is incomplete for ${input.stewardWorkId}. Run ${resumeRunnerSyncCommand(input.stewardWorkId, String(receipt.sealedSourceSha ?? input.group.sealedSourceSha))}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resumeRunnerSyncCommand(stewardWorkId: string, sealedSourceSha: string): string {
  return `node atm.mjs broker runner-sync resume --steward-work-id ${JSON.stringify(stewardWorkId)} --sealed-source-sha ${JSON.stringify(sealedSourceSha)} --json`;
}

function normalizeReceiptStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? '').trim().replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function toRunnerSyncQueueCliError(error: unknown): CliError {
  const messageText = error instanceof Error ? error.message : String(error ?? '');
  const match = /^(ATM_[A-Z0-9_]+):\s*(.+)$/.exec(messageText);
  if (match) {
    return new CliError(match[1], match[2], { exitCode: 1 });
  }
  return new CliError('ATM_RUNNER_SYNC_QUEUE_FAILED', messageText || 'Runner-sync steward queue operation failed.', { exitCode: 1 });
}
