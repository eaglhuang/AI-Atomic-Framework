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
import { cleanupRunnerSyncStewardQueue, emptyRunnerSyncStewardQueue, enqueueRunnerSyncStewardRequest, explainRunnerSyncStewardPosition, releaseRunnerSyncStewardQueue, releaseRunnerSyncStewardTaskRequests, type RunnerSyncStewardQueueDocument } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { cleanupGeneratedProjectionSteward, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, type GeneratedProjectionStewardDocument } from '../../../../core/src/broker/generated-projection-steward.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, type FreezeAck, type FreezeResolution, type FreezeSignal } from '../../../../core/src/broker/freeze.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord, ExplicitMutationIntentInputSummary, ExplicitMutationIntentKind, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';

function readBrokerWriteIntent(intentFilePath: string, displayPath: string): WriteIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(intentFilePath, 'utf8'));
  } catch (error) {
    throw new CliError('ATM_BROKER_INTENT_INVALID_JSON', `Intent file is not valid JSON: ${displayPath}`, {
      exitCode: 2,
      details: { intentFile: displayPath, error: error instanceof Error ? error.message : String(error) }
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('ATM_BROKER_INTENT_INVALID', 'Broker intent file must contain a JSON object.', {
      exitCode: 2,
      details: { intentFile: displayPath }
    });
  }
  const record = parsed as Record<string, unknown>;
  const missing = [
    record.schemaId === 'atm.writeIntent.v1' ? null : 'schemaId',
    typeof record.taskId === 'string' && record.taskId.trim() ? null : 'taskId',
    typeof record.actorId === 'string' && record.actorId.trim() ? null : 'actorId',
    typeof record.baseCommit === 'string' && record.baseCommit.trim() ? null : 'baseCommit',
    Array.isArray(record.targetFiles) ? null : 'targetFiles',
    Array.isArray(record.atomRefs) ? null : 'atomRefs',
    record.sharedSurfaces && typeof record.sharedSurfaces === 'object' && !Array.isArray(record.sharedSurfaces) ? null : 'sharedSurfaces',
    typeof record.requestedLane === 'string' && record.requestedLane.trim() ? null : 'requestedLane'
  ].filter(Boolean) as string[];
  const sharedSurfaces = record.sharedSurfaces as Record<string, unknown> | undefined;
  if (sharedSurfaces) {
    for (const key of ['generators', 'projections', 'registries', 'validators', 'artifacts']) {
      if (!Array.isArray(sharedSurfaces[key])) missing.push(`sharedSurfaces.${key}`);
    }
  }
  if (missing.length > 0) {
    throw new CliError('ATM_BROKER_INTENT_INVALID', 'Broker intent file is missing required WriteIntent fields.', {
      exitCode: 2,
      details: {
        intentFile: displayPath,
        missingFields: missing
      }
    });
  }
  return record as WriteIntent;
}


export function handleBrokerRegistryActions(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  const registryPath = context.registryPath;
  const sharedQueuePath = context.sharedQueuePath;
  const sharedFreezePath = context.sharedFreezePath;
  if (options.action === 'register') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker register requires --task <task-id>.', { exitCode: 2 });
    }
    if (!options.intentFile) {
      throw new CliError('ATM_CLI_USAGE', 'broker register requires --intent-file <path>.', { exitCode: 2 });
    }
    const intentFilePath = path.resolve(options.intentFile);
    if (!existsSync(intentFilePath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Intent file not found: ${options.intentFile}`, { exitCode: 1 });
    }

    const newIntent = readBrokerWriteIntent(intentFilePath, options.intentFile);
    assertBrokerRegisterCliParity(newIntent, options);
    let registry = cleanupStale(loadRegistry(registryPath));
    const decision = calculateBrokerDecision(newIntent, registry);
    const conflictMatrix = decision.conflictMatrix;
    const isDecisionSafe = decision.verdict === 'parallel-safe' || decision.verdict === 'serial';

    // 即使決策是 blocked，我們依然將其以 blocked 狀態註冊進去
    registry = registerIntent(registry, newIntent, decision.lane, options.ttlSeconds, decision.admission);
    const queueUpdate = updateSharedSurfaceQueues({
      queuePath: sharedQueuePath,
      intent: newIntent,
      registry,
      shouldQueue: shouldQueueSharedSurface(decision)
    });
    const queueAdmission = resolveSharedSurfaceQueueAdmission({ intent: newIntent, queues: queueUpdate.queues });
    const isBrokerSafe = isDecisionSafe || queueAdmission.status === 'queue-head' || queueAdmission.status === 'queued-private-work';
    if (queueAdmission.status === 'queued-private-work' || queueAdmission.status === 'queue-head') {
      registry = replaceIntentLane(registry, newIntent.taskId, 'direct-brokered');
    }
    const freezes = createSharedSurfaceFreezeRecords({
      existing: readSharedSurfaceFreezeRecords(sharedFreezePath),
      queueUpdate,
      waitingIntent: newIntent
    });
    writeSharedSurfaceFreezeRecords(sharedFreezePath, freezes);
    saveRegistry(registryPath, registry);
    syncTeamRunRearbitrationSnapshots(options.cwd, registry, newIntent.taskId, newIntent.actorId);

    return makeResult({
      ok: isBrokerSafe,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          isBrokerSafe ? 'info' : 'error',
          'ATM_BROKER_REGISTERED',
          `Write intent registered with verdict '${decision.verdict}', lane '${decision.lane}', queue '${queueAdmission.status}', and admission '${decision.admission?.state ?? 'not-required'}'. Arbitration matrix verdict: '${conflictMatrix?.arbitrationVerdict ?? 'n/a'}'. Broker verdicts override Coordinator decisions inside broker-governed conflict domains; Coordinator remains local outside them.`,
          { decision, queueAdmission }
        )
      ],
      evidence: {
        decision,
        queueAdmission,
        registryPath: '.atm/runtime/write-broker.registry.json',
        sharedSurfaceQueues: queueUpdate.queues,
        sharedSurfaceFreezes: freezes
      }
    });
  }

  if (options.action === 'heartbeat') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker heartbeat requires --task <task-id>.', { exitCode: 2 });
    }
    if (!options.actorId) {
      throw new CliError('ATM_CLI_USAGE', 'broker heartbeat requires --actor <actor-id>.', { exitCode: 2 });
    }
    let registry = cleanupStale(loadRegistry(registryPath));
    registry = renewIntentLease(registry, options.task, options.actorId, options.ttlSeconds);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_HEARTBEAT_RENEWED', `Renewed write-intent lease for task ${options.task}.`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        renewedTask: options.task,
        actorId: options.actorId
      }
    });
  }

  if (options.action === 'decision') {
    if (!options.intentFile) {
      throw new CliError('ATM_CLI_USAGE', 'broker decision requires --intent-file <path>.', { exitCode: 2 });
    }
    const intentFilePath = path.resolve(options.intentFile);
    if (!existsSync(intentFilePath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Intent file not found: ${options.intentFile}`, { exitCode: 1 });
    }

    const newIntent = readBrokerWriteIntent(intentFilePath, options.intentFile);
    const registry = cleanupStale(loadRegistry(registryPath));
    const decision = calculateBrokerDecision(newIntent, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_DECISION', `Calculated broker decision: verdict '${decision.verdict}', lane '${decision.lane}', admission '${decision.admission?.state ?? 'not-required'}'`)
      ],
      evidence: {
        decision
      }
    });
  }

  if (options.action === 'status') {
    const registry = cleanupStale(loadRegistry(registryPath));
    const sharedSurfaceQueues = readSharedSurfaceQueues(sharedQueuePath);
    const sharedSurfaceFreezes = readSharedSurfaceFreezeRecords(sharedFreezePath);
    const effectiveIntents = registry.activeIntents.map((activeIntent) =>
      projectTeamBrokerRearbitrationSnapshot({
        activeIntent,
        registry,
        triggerTaskId: activeIntent.taskId,
        triggerActorId: activeIntent.actorId
      })
    );
    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_STATUS', `Active write intents in registry: ${registry.activeIntents.length}`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        activeIntents: registry.activeIntents,
        effectiveIntents,
        admissionStates: registry.activeIntents.map((intent) => ({
          taskId: intent.taskId,
          actorId: intent.actorId,
          lane: intent.lane,
          admissionState: intent.admission?.state ?? 'not-required',
          admissionTrigger: intent.admission?.trigger ?? 'not-required'
        })),
        sharedSurfaceQueues,
        sharedSurfaceFreezes,
        sharedSurfaceAcquisitionPlans: registry.activeIntents.map((intent) => planSharedSurfaceAcquisition(sharedSurfaceQueues, intent.taskId))
      }
    });
  }

  if (options.action === 'release') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker release requires --task <task-id>.', { exitCode: 2 });
    }
    const releaseTaskId = options.task;
    let registry = cleanupStale(loadRegistry(registryPath));
    registry = releaseTask(registry, releaseTaskId);
    saveRegistry(registryPath, registry);
    const queues = readSharedSurfaceQueues(sharedQueuePath);
    const updatedQueues = queues.flatMap((queue) => {
      const released = removeSharedSurfaceEntry({ queue, taskId: releaseTaskId });
      return released.entries.length === 0 ? [] : [released];
    });
    writeSharedSurfaceQueues(sharedQueuePath, updatedQueues);
    const runnerSyncRelease = releaseRunnerSyncStewardTaskRequests(
      readRunnerSyncStewardQueue(context.runnerSyncQueuePath),
      releaseTaskId
    );
    writeRunnerSyncStewardQueue(context.runnerSyncQueuePath, runnerSyncRelease.queue);
    const freezes = markReleasedSharedSurfaceFreezes({
      records: readSharedSurfaceFreezeRecords(sharedFreezePath),
      releasedTaskId: releaseTaskId,
      queues: updatedQueues
    });
    writeSharedSurfaceFreezeRecords(sharedFreezePath, freezes);
    const runtimeCleanup = cleanupBrokerRuntimeSnapshots({
      cwd: options.cwd,
      releasedTaskIds: [releaseTaskId],
      activeTaskIds: registry.activeIntents.map((intent) => intent.taskId)
    });

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_RELEASED', `Released all write intents for task ${options.task}`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        releasedTask: releaseTaskId,
        sharedSurfaceQueues: updatedQueues,
        runnerSyncStewardRelease: runnerSyncRelease,
        sharedSurfaceFreezes: freezes,
        runtimeCleanup
      }
    });
  }

  if (options.action === 'acknowledge') {
    if (!options.task || !options.actorId || !options.freezeId) {
      throw new CliError('ATM_CLI_USAGE', 'broker acknowledge requires --task <task-id>, --actor <actor-id>, and --freeze-id <freeze-id>.', { exitCode: 2 });
    }
    const records = readSharedSurfaceFreezeRecords(sharedFreezePath);
    const record = records.find((candidate) => candidate.signal.freezeId === options.freezeId);
    if (!record || record.signal.taskId !== options.task || record.signal.actorId !== options.actorId) {
      throw new CliError('ATM_BROKER_FREEZE_ACK_FORBIDDEN', 'Only the notified queue head may acknowledge this Broker freeze.', { exitCode: 1 });
    }
    const ack = acknowledgeFreeze(record.signal);
    const resolution = resolveFreezeDecision({ signal: record.signal, acknowledgedAt: ack.acknowledgedAt });
    const next = records.map((candidate) => candidate.signal.freezeId === options.freezeId
      ? { ...candidate, ack, resolution, status: 'acknowledged' as const, updatedAt: ack.acknowledgedAt }
      : candidate);
    writeSharedSurfaceFreezeRecords(sharedFreezePath, next);
    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [message('info', 'ATM_BROKER_FREEZE_ACKNOWLEDGED', `Acknowledged Broker freeze ${options.freezeId}; publish a patch proposal or release the shared surface when ready.`)],
      evidence: { freeze: next.find((candidate) => candidate.signal.freezeId === options.freezeId) }
    });
  }

  if (options.action === 'cleanup') {
    let registry = cleanupStale(loadRegistry(registryPath));
    registry = cleanupStale(registry);
    saveRegistry(registryPath, registry);
    const runtimeCleanup = cleanupBrokerRuntimeSnapshots({
      cwd: options.cwd,
      activeTaskIds: registry.activeIntents.map((intent) => intent.taskId)
    });

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_CLEANED', 'Cleaned up stale write intents from registry')
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        runtimeCleanup
      }
    });
  }

  return null;
}
