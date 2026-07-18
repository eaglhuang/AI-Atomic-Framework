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
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';

export function classifyExplicitMutationRequest(request: MutationRequest): {
  readonly explicitInputs: readonly ExplicitMutationIntentInputSummary[];
  readonly missingInputs: readonly MutationIntentMissingInput[];
} {
  const missingInputs: MutationIntentMissingInput[] = [];
  const filePath = typeof request.filePath === 'string' ? request.filePath : '';
  const normalizedFilePath = filePath.trim();
  const op = typeof request.op === 'string' ? request.op.trim() : '';
  const target = typeof request.target === 'string' ? request.target.trim() : '';
  const requestId =
    typeof request.requestId === 'string' && request.requestId.trim()
      ? request.requestId.trim()
      : [
          normalizedFilePath || 'unknown-file',
          op || 'unknown-op',
          target || 'unknown-target'
        ].join(':');
  const kind = resolveExplicitMutationIntentKind(request, filePath, op, target);

  if (!normalizedFilePath) {
    missingInputs.push({
      requestId,
      filePath,
      kind: kind ?? 'unknown',
      field: 'filePath',
      reason: 'filePath is required for broker mutation intent.'
    });
  }
  if (!op) {
    missingInputs.push({
      requestId,
      filePath,
      kind: kind ?? 'unknown',
      field: 'op',
      reason: 'operation is required; broker does not infer operations from prose.'
    });
  }
  if (!target) {
    missingInputs.push({
      requestId,
      filePath,
      kind: kind ?? 'unknown',
      field: 'target',
      reason: 'target/region is required; broker does not guess write regions.'
    });
  }

  if (missingInputs.length > 0 || !kind) {
    return { explicitInputs: [], missingInputs };
  }

  return {
    explicitInputs: [
      {
        requestId,
        filePath,
        kind,
        op,
        target
      }
    ],
    missingInputs
  };
}

function resolveExplicitMutationIntentKind(
  request: MutationRequest,
  filePath: string,
  op: string,
  target: string
): ExplicitMutationIntentKind | null {
  const explicitKind = (request as MutationRequest & { intentKind?: ExplicitMutationIntentKind }).intentKind;
  if (explicitKind) {
    return explicitKind;
  }
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.includes('/path-to-atom-map-shards/owner-shard-') && target) {
    return 'owner-shard-row-target';
  }
  if ((normalizedPath.endsWith('.scalars.json') || normalizedPath.endsWith('.counter.json')) && target) {
    return 'scalar-operation';
  }
  if ((normalizedPath.endsWith('.md') || normalizedPath.endsWith('.txt')) && target) {
    return 'text-range';
  }
  if (normalizedPath.endsWith('.json') && target.startsWith('/')) {
    return 'json-pointer';
  }
  if (op && target) {
    return 'mutation-request';
  }
  return null;
}

export function buildMutationEvidence(
  adapterId: string,
  request: MutationRequest,
  baseHash: string,
  resultHash: string,
  mergeDecision: BrokerMutationEvidenceEntry['mergeDecision'],
  verdict: BrokerMutationEvidenceEntry['verdict'],
  conflictKeys: readonly ConflictKey[]
): BrokerMutationEvidenceEntry {
  return {
    requestId: request.requestId,
    actorId: request.actorId,
    adapterId,
    filePath: request.filePath,
    baseHash,
    resultHash,
    conflictKeys,
    mergeDecision,
    verdict
  };
}

export function extractMutationRequestTransactionIds(request: MutationRequest): readonly string[] {
  const source = request as MutationRequest & {
    transactionId?: unknown;
    transactionIds?: unknown;
    transaction_ids?: unknown;
  };
  const values = [
    source.transactionId,
    ...(Array.isArray(source.transactionIds) ? source.transactionIds : [source.transactionIds]),
    ...(Array.isArray(source.transaction_ids) ? source.transaction_ids : [source.transaction_ids])
  ];
  return [...new Set(values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
