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
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';

function readSharedSurfaceFreezeRecords(filePath: string): SharedSurfaceFreezeRecord[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { records?: SharedSurfaceFreezeRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeSharedSurfaceFreezeRecords(filePath: string, records: readonly SharedSurfaceFreezeRecord[]) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ schemaId: 'atm.brokerSharedSurfaceFreezes.v1', records }, null, 2)}\n`, 'utf8');
}

function readSharedSurfaceQueues(filePath: string): SharedSurfaceQueue[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { queues?: SharedSurfaceQueue[] };
    return Array.isArray(parsed.queues) ? parsed.queues : [];
  } catch {
    return [];
  }
}

function writeSharedSurfaceQueues(filePath: string, queues: readonly SharedSurfaceQueue[]) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ schemaId: 'atm.brokerSharedSurfaceQueues.v1', queues }, null, 2)}\n`, 'utf8');
}

function readRunnerSyncStewardQueue(filePath: string): RunnerSyncStewardQueueDocument {
  if (!existsSync(filePath)) return emptyRunnerSyncStewardQueue();
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as RunnerSyncStewardQueueDocument;
  } catch {
    return emptyRunnerSyncStewardQueue();
  }
}

function writeRunnerSyncStewardQueue(filePath: string, queue: RunnerSyncStewardQueueDocument) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

function toRunnerSyncReleaseCliError(error: unknown): CliError {
  const messageText = error instanceof Error ? error.message : String(error ?? '');
  const match = /^(ATM_[A-Z0-9_]+):\s*(.+)$/.exec(messageText);
  if (match) {
    return new CliError(match[1], match[2], { exitCode: 1 });
  }
  return new CliError('ATM_RUNNER_SYNC_STEWARD_RELEASE_FAILED', messageText || 'Runner-sync steward release failed.', { exitCode: 1 });
}

function readGeneratedProjectionSteward(filePath: string): GeneratedProjectionStewardDocument {
  if (!existsSync(filePath)) return emptyGeneratedProjectionSteward();
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as GeneratedProjectionStewardDocument;
  } catch {
    return emptyGeneratedProjectionSteward();
  }
}

function writeGeneratedProjectionSteward(filePath: string, queue: GeneratedProjectionStewardDocument) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

export { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward };
