// @ts-nocheck
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { cleanupGeneratedProjectionSteward, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, type GeneratedProjectionStewardDocument } from '../../../../core/src/broker/generated-projection-steward.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, type FreezeAck, type FreezeResolution, type FreezeSignal } from '../../../../core/src/broker/freeze.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord, ExplicitMutationIntentInputSummary, ExplicitMutationIntentKind, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';


export function handleBrokerStewardQueues(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  const runnerSyncQueuePath = context.runnerSyncQueuePath;
  const projectionStewardPath = context.projectionStewardPath;
  if (options.action === 'runner-sync') {
    if (options.runnerSyncAction === 'enqueue') {
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
      const result = enqueueRunnerSyncStewardRequest(readRunnerSyncStewardQueue(runnerSyncQueuePath), {
        taskId: options.task,
        actorId: options.actorId,
        sealedSourceSha: options.sealedSourceSha,
        requestedSurfaces: options.surfaces,
        ttlSeconds: options.ttlSeconds
      });
      writeRunnerSyncStewardQueue(runnerSyncQueuePath, result.queue);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_RUNNER_SYNC_ENQUEUED', `Runner-sync request is ${result.status} at position ${result.queuePosition} for steward work ${result.stewardWorkId}.`, {
            status: result.status,
            queuePosition: result.queuePosition,
            stewardWorkId: result.stewardWorkId,
            waitingTasks: result.waitingTasks,
            suggestedNextAction: result.suggestedNextAction
          })
        ],
        evidence: {
          runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
          runnerSync: result
        }
      });
    }

    if (options.runnerSyncAction === 'status') {
      const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
      const position = options.task ? explainRunnerSyncStewardPosition(queue, options.task) : null;
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
        const release = releaseRunnerSyncStewardQueue(readRunnerSyncStewardQueue(runnerSyncQueuePath), {
          taskId: options.task,
          stewardWorkId: options.stewardWorkId,
          receiptRef: options.receiptRef,
          receiptDigest: options.receiptDigest
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

    throw new CliError('ATM_CLI_USAGE', 'broker runner-sync supports: enqueue, status, cleanup, release', { exitCode: 2 });
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
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_PROJECTION_ENQUEUED', `Generated projection rebuild for ${result.projectionKey} is at position ${result.queuePosition}; owner is ${result.ownerTaskId}.`, {
            projectionKey: result.projectionKey,
            ownerTaskId: result.ownerTaskId,
            queuePosition: result.queuePosition,
            suggestedNextAction: result.suggestedNextAction
          })
        ],
        evidence: {
          generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
          projection: result
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

function resolveRunnerSyncTaskHealth(cwd: string, request: RunnerSyncStewardRequest): RunnerSyncTaskHealth {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${request.taskId}.json`);
  if (!existsSync(taskPath)) {
    return 'task-missing';
  }
  try {
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const status = typeof task.status === 'string' ? task.status.trim().toLowerCase() : '';
    return status === 'done' || status === 'verified' || status === 'abandoned'
      ? 'task-terminal'
      : 'task-active';
  } catch {
    return 'task-active';
  }
}
