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
import { cleanupRunnerSyncStewardQueue, emptyRunnerSyncStewardQueue, enqueueRunnerSyncStewardRequest, explainRunnerSyncStewardPosition, releaseRunnerSyncStewardQueue, type RunnerSyncStewardQueueDocument } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { cleanupGeneratedProjectionSteward, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, type GeneratedProjectionStewardDocument } from '../../../../core/src/broker/generated-projection-steward.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, type FreezeAck, type FreezeResolution, type FreezeSignal } from '../../../../core/src/broker/freeze.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord, ExplicitMutationIntentInputSummary, ExplicitMutationIntentKind, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';


export function updateSharedSurfaceQueues(input: {
  queuePath: string;
  intent: WriteIntent;
  registry: { activeIntents: readonly ActiveWriteIntent[] };
  shouldQueue: boolean;
}): { readonly queues: SharedSurfaceQueue[]; readonly newlyQueued: readonly { readonly surfacePath: string; readonly queueHead: ActiveWriteIntent }[] } {
  const queues = readSharedSurfaceQueues(input.queuePath);
  if (!input.shouldQueue) return { queues, newlyQueued: [] };
  const activeOwnersByPath = new Map<string, ActiveWriteIntent[]>();
  for (const active of input.registry.activeIntents) {
    if (active.taskId === input.intent.taskId) continue;
    for (const filePath of active.resourceKeys.files) {
      const normalized = filePath.replace(/\\/g, '/');
      if (!input.intent.targetFiles.map((value) => value.replace(/\\/g, '/')).includes(normalized)) continue;
      activeOwnersByPath.set(normalized, [...(activeOwnersByPath.get(normalized) ?? []), active]);
    }
  }
  const sharedPaths = [...activeOwnersByPath.keys()].sort();
  if (sharedPaths.length === 0) return { queues, newlyQueued: [] };
  const next = queues.slice();
  const newlyQueued: Array<{ surfacePath: string; queueHead: ActiveWriteIntent }> = [];
  for (const surfacePath of sharedPaths) {
    const index = next.findIndex((queue) => queue.surfacePath === surfacePath);
    let queue = index >= 0 ? next[index] : null;
    for (const owner of activeOwnersByPath.get(surfacePath) ?? []) {
      const seeded = enqueueSharedSurface({
        queue,
        entry: sharedQueueEntry(owner, surfacePath, 'Broker queue head owns this shared path until governed release.')
      });
      if (!seeded.ok) throw new CliError('ATM_BROKER_SHARED_QUEUE_BLOCKED', seeded.reason, { exitCode: 1, details: { surfacePath, code: seeded.code } });
      queue = seeded.queue;
    }
    const result = enqueueSharedSurface({
      queue,
      entry: {
        taskId: input.intent.taskId,
        actorId: input.intent.actorId,
        surfacePath,
        leaseEpoch: input.registry.activeIntents.find((entry) => entry.taskId === input.intent.taskId)?.leaseEpoch ?? Date.now(),
        baseHash: input.intent.baseCommit,
        reason: 'Broker admitted private-path progress while this shared surface is queued.',
        releaseCondition: 'Prior queue head releases its broker intent after governed delivery.',
        queuedAt: new Date().toISOString()
      }
    });
    if (!result.ok) throw new CliError('ATM_BROKER_SHARED_QUEUE_BLOCKED', result.reason, { exitCode: 1, details: { surfacePath, code: result.code } });
    const queueHead = (activeOwnersByPath.get(surfacePath) ?? [])[0];
    if (result.position && result.position > 1 && queueHead) newlyQueued.push({ surfacePath, queueHead });
    if (index >= 0) next[index] = result.queue; else next.push(result.queue);
  }
  writeSharedSurfaceQueues(input.queuePath, next);
  return { queues: next, newlyQueued };
}

export function createSharedSurfaceFreezeRecords(input: {
  readonly existing: readonly SharedSurfaceFreezeRecord[];
  readonly queueUpdate: { readonly newlyQueued: readonly { readonly surfacePath: string; readonly queueHead: ActiveWriteIntent }[] };
  readonly waitingIntent: WriteIntent;
}): SharedSurfaceFreezeRecord[] {
  const records = [...input.existing];
  for (const [index, queued] of input.queueUpdate.newlyQueued.entries()) {
    const duplicate = records.some((record) => record.surfacePath === queued.surfacePath
      && record.signal.taskId === queued.queueHead.taskId
      && record.waitingTaskId === input.waitingIntent.taskId
      && record.status !== 'released');
    if (duplicate) continue;
    const signal = createFreezeSignal({
      taskId: queued.queueHead.taskId,
      actorId: queued.queueHead.actorId,
      blockingTask: input.waitingIntent.taskId,
      blockingRoute: 'broker-shared-surface-queue',
      conflictingResource: queued.surfacePath,
      now: Date.now() + index
    });
    records.push({
      schemaId: 'atm.brokerSharedSurfaceFreeze.v1',
      surfacePath: queued.surfacePath,
      waitingTaskId: input.waitingIntent.taskId,
      waitingActorId: input.waitingIntent.actorId,
      signal,
      status: 'pending',
      requiredNextAction: 'publish-patch-proposal-or-release',
      createdAt: signal.issuedAt,
      updatedAt: signal.issuedAt
    });
  }
  return records;
}

export function markReleasedSharedSurfaceFreezes(input: {
  readonly records: readonly SharedSurfaceFreezeRecord[];
  readonly releasedTaskId: string;
  readonly queues: readonly SharedSurfaceQueue[];
}): SharedSurfaceFreezeRecord[] {
  const now = new Date().toISOString();
  return input.records.map((record) => {
    if (record.signal.taskId !== input.releasedTaskId || record.status === 'released') return record;
    const queue = input.queues.find((candidate) => candidate.surfacePath === record.surfacePath);
    const waitingIsHead = queue?.entries[0]?.taskId === record.waitingTaskId;
    if (!waitingIsHead) return record;
    return { ...record, status: 'released' as const, updatedAt: now };
  });
}

function sharedQueueEntry(owner: ActiveWriteIntent, surfacePath: string, reason: string) {
  return {
    taskId: owner.taskId,
    actorId: owner.actorId,
    surfacePath,
    leaseEpoch: owner.leaseEpoch,
    baseHash: owner.baseCommit,
    reason,
    releaseCondition: 'Release the broker intent after the governed delivery or terminal archive.',
    queuedAt: owner.heartbeatAt
  };
}

export function shouldQueueSharedSurface(decision: ReturnType<typeof calculateBrokerDecision>): boolean {
  // `needs-physical-split` is the file-scoped queue path. Its conflict matrix
  // may remain `allow` because the Composer can safely serialize the shared
  // files; requiring a matrix block here accidentally suppresses the queue.
  if (decision.verdict === 'needs-physical-split') return decision.conflicts.some((conflict) => conflict.kind === 'file-range');
  // A CID conflict remains fail-closed at the decision layer. When the
  // registry can also identify concrete shared files, updateSharedSurfaceQueues
  // will materialize the bounded queue; semantic-only CID conflicts find no
  // shared paths and remain a global block.
  if (decision.verdict === 'blocked-cid-conflict') return true;
  return decision.verdict === 'blocked-shared-surface'
    && (decision.conflictMatrix?.gateResults.some((gate) => gate.status === 'block') ?? false);
}

type SharedSurfaceQueueAdmission = {
  readonly status: 'not-queued' | 'queue-head' | 'queued-private-work' | 'queued-blocked';
  readonly queuedSharedPaths: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly reason: string;
};

export function resolveSharedSurfaceQueueAdmission(input: {
  readonly intent: WriteIntent;
  readonly queues: readonly SharedSurfaceQueue[];
}): SharedSurfaceQueueAdmission {
  const existingEntries = input.queues.flatMap((queue) => queue.entries.filter((entry) => entry.taskId === input.intent.taskId));
  if (existingEntries.some((entry) => entry.baseHash !== input.intent.baseCommit)) {
    return {
      status: 'queued-blocked',
      queuedSharedPaths: [...new Set(existingEntries.map((entry) => entry.surfacePath))].sort(),
      allowedFiles: [],
      reason: 'Canonical shared-surface queue base hash differs from the pre-claim transaction; re-arbitration is required.'
    };
  }
  const waitingQueues = input.queues.filter((queue) => {
    const position = queue.entries.findIndex((entry) => entry.taskId === input.intent.taskId);
    return position > 0;
  });
  if (waitingQueues.length === 0) {
    const heads = input.queues.filter((queue) => queue.entries[0]?.taskId === input.intent.taskId);
    return heads.length > 0
      ? { status: 'queue-head', queuedSharedPaths: [], allowedFiles: input.intent.targetFiles, reason: 'Task owns every queued shared surface.' }
      : { status: 'not-queued', queuedSharedPaths: [], allowedFiles: input.intent.targetFiles, reason: 'No bounded shared-surface queue applies.' };
  }
  const queuedSharedPaths = [...new Set(waitingQueues.map((queue) => queue.surfacePath))].sort();
  const allowedFiles = input.intent.targetFiles
    .map((filePath) => filePath.replace(/\\/g, '/'))
    .filter((filePath) => !queuedSharedPaths.includes(filePath));
  return allowedFiles.length > 0
    ? { status: 'queued-private-work', queuedSharedPaths, allowedFiles, reason: 'Shared paths are queued; disjoint private paths may proceed.' }
    : { status: 'queued-blocked', queuedSharedPaths, allowedFiles: [], reason: 'Every requested write path is behind a shared-surface queue head.' };
}

export function replaceIntentLane(
  registry: WriteBrokerRegistryDocument,
  taskId: string,
  lane: ActiveWriteIntent['lane']
): WriteBrokerRegistryDocument {
  return {
    ...registry,
    activeIntents: registry.activeIntents.map((intent) => intent.taskId === taskId ? { ...intent, lane } : intent)
  };
}

export function assertBrokerRegisterCliParity(intent: WriteIntent, options: Pick<ParsedBrokerOptions, 'task' | 'actorId' | 'intentFile'>): void {
  const mismatches: Array<{ field: 'taskId' | 'actorId'; cliValue: string; payloadValue: string }> = [];
  if (options.task && intent.taskId !== options.task) {
    mismatches.push({
      field: 'taskId',
      cliValue: options.task,
      payloadValue: intent.taskId
    });
  }
  if (options.actorId && intent.actorId !== options.actorId) {
    mismatches.push({
      field: 'actorId',
      cliValue: options.actorId,
      payloadValue: intent.actorId
    });
  }
  if (mismatches.length === 0) {
    return;
  }
  const mismatchSummary = mismatches
    .map((entry) => `${entry.field}: CLI=${entry.cliValue} payload=${entry.payloadValue}`)
    .join('; ');
  const mismatchFields = mismatches.map((entry) => entry.field);
  throw new CliError(
    'ATM_BROKER_REGISTER_PAYLOAD_FLAG_MISMATCH',
    `broker register CLI flags do not match intent payload. ${mismatchSummary}`,
    {
      exitCode: 1,
      details: {
        intentFile: options.intentFile,
        mismatchCount: mismatches.length,
        mismatchFields,
        mismatches
      }
    }
  );
}

export function syncTeamRunRearbitrationSnapshots(
  cwd: string,
  registry: ReturnType<typeof loadRegistry>,
  triggerTaskId: string,
  triggerActorId: string
) {
  const teamRunDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(teamRunDir)) {
    return;
  }
  const latestRunByTask = new Map<string, { filePath: string; payload: Record<string, unknown> }>();
  const entries = readdirSync(teamRunDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(teamRunDir, entry.name))
    .sort();

  for (const filePath of entries) {
    try {
      const payload = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      if (payload.schemaId !== 'atm.teamRun.v1') {
        continue;
      }
      const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
      if (!taskId) {
        continue;
      }
      const current = latestRunByTask.get(taskId);
      const currentStamp = typeof current?.payload.updatedAt === 'string' ? current.payload.updatedAt : '';
      const nextStamp = typeof payload.updatedAt === 'string' ? payload.updatedAt : '';
      if (!current || nextStamp >= currentStamp) {
        latestRunByTask.set(taskId, { filePath, payload });
      }
    } catch {
      // ignore malformed runtime files
    }
  }

  for (const activeIntent of registry.activeIntents) {
    const teamRun = latestRunByTask.get(activeIntent.taskId);
    if (!teamRun) {
      continue;
    }
    const brokerLane = teamRun.payload.brokerLane;
    if (!brokerLane || typeof brokerLane !== 'object' || Array.isArray(brokerLane)) {
      continue;
    }
    const snapshot = projectTeamBrokerRearbitrationSnapshot({
      activeIntent,
      registry,
      triggerTaskId,
      triggerActorId
    });
    const updated = {
      ...teamRun.payload,
      brokerLane: {
        ...(brokerLane as Record<string, unknown>),
        rearbitration: snapshot
      },
      updatedAt: snapshot.observedAt
    };
    writeFileSync(teamRun.filePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
}
