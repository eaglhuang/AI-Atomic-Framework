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
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';

const defaultFallbackBrokerRunEvidenceRelativeDir = path.join(
  '.atm',
  'runtime',
  'broker-collision-evidence',
  'runs'
);

export interface ParsedBrokerOptions {
  readonly cwd: string;
  readonly action: 'register' | 'heartbeat' | 'decision' | 'status' | 'release' | 'acknowledge' | 'cleanup' | 'proposal' | 'compose' | 'steward' | 'runtime' | 'runner-sync' | 'projection' | 'plan-batch' | 'schedule' | null;
  readonly proposalAction: 'create' | 'list' | 'show' | 'validate' | null;
  readonly stewardAction: 'plan' | 'apply' | null;
  readonly runtimeAction: 'activate' | null;
  readonly runnerSyncAction: 'enqueue' | 'status' | 'cleanup' | 'release' | null;
  readonly projectionAction: 'enqueue' | 'status' | 'cleanup' | null;
  readonly scheduleAction: 'enqueue' | 'plan' | 'status' | null;
  readonly task: string | null;
  readonly actorId: string | null;
  readonly sealedSourceSha: string | null;
  readonly stewardWorkId: string | null;
  readonly receiptRef: string | null;
  readonly receiptDigest: string | null;
  readonly projectionKey: string | null;
  readonly waveId: string | null;
  readonly surfaceKind: 'commit' | 'runner-sync' | 'projection' | 'checkpoint' | null;
  readonly surfaceFamily: string | null;
  readonly payloadDigest: string | null;
  readonly expectedTasks: readonly string[];
  readonly collectionTimeoutMs: number;
  readonly intentFile: string | null;
  readonly freezeId: string | null;
  readonly ttlSeconds: number;
  readonly surfaces: readonly string[];
  readonly sourceItems: readonly string[];
  readonly proposalFiles: readonly string[];
  readonly proposalIds: readonly string[];
  readonly proposalStorePath: string | null;
  readonly mergePlanFile: string | null;
  readonly scopeFiles: readonly string[];
  readonly stewardId: string | null;
  readonly evidenceOutPath: string | null;
  readonly requestFiles: readonly string[];
  readonly requestsDir: string | null;
  readonly runEvidenceDir: string | null;
  readonly apply: boolean;
}

export function parseBrokerArgs(argv: string[]): ParsedBrokerOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedBrokerOptions['action'],
    proposalAction: null as ParsedBrokerOptions['proposalAction'],
    stewardAction: null as ParsedBrokerOptions['stewardAction'],
    runtimeAction: null as ParsedBrokerOptions['runtimeAction'],
    runnerSyncAction: null as ParsedBrokerOptions['runnerSyncAction'],
    projectionAction: null as ParsedBrokerOptions['projectionAction'],
    scheduleAction: null as ParsedBrokerOptions['scheduleAction'],
    task: null as string | null,
    actorId: null as string | null,
    sealedSourceSha: null as string | null,
    stewardWorkId: null as string | null,
    receiptRef: null as string | null,
    receiptDigest: null as string | null,
    projectionKey: null as string | null,
    waveId: null as string | null,
    surfaceKind: null as ParsedBrokerOptions['surfaceKind'],
    surfaceFamily: null as string | null,
    payloadDigest: null as string | null,
    expectedTasks: [] as string[],
    collectionTimeoutMs: 120000,
    intentFile: null as string | null,
    freezeId: null as string | null,
    ttlSeconds: 1800,
    surfaces: [] as string[],
    sourceItems: [] as string[],
    proposalFiles: [] as string[],
    proposalIds: [] as string[],
    proposalIdPositional: null as string | null,
    proposalStorePath: null as string | null,
    mergePlanFile: null as string | null,
    scopeFiles: [] as string[],
    stewardId: null as string | null,
    evidenceOutPath: null as string | null,
    requestFiles: [] as string[],
    requestsDir: null as string | null,
    runEvidenceDir: null as string | null,
    apply: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.task = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--sealed-source-sha') {
      state.sealedSourceSha = requireValue(argv, index, '--sealed-source-sha');
      index += 1;
      continue;
    }
    if (arg === '--steward-work-id') {
      state.stewardWorkId = requireValue(argv, index, '--steward-work-id');
      index += 1;
      continue;
    }
    if (arg === '--receipt-ref' || arg === '--receipt') {
      state.receiptRef = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--receipt-digest') {
      state.receiptDigest = requireValue(argv, index, '--receipt-digest');
      index += 1;
      continue;
    }
    if (arg === '--projection-key') {
      state.projectionKey = requireValue(argv, index, '--projection-key');
      index += 1;
      continue;
    }
    if (arg === '--wave') {
      state.waveId = requireValue(argv, index, '--wave');
      index += 1;
      continue;
    }
    if (arg === '--surface-kind') {
      const surfaceKind = requireValue(argv, index, '--surface-kind');
      if (!['commit', 'runner-sync', 'projection', 'checkpoint'].includes(surfaceKind)) {
        throw new CliError('ATM_CLI_USAGE', `unsupported --surface-kind ${surfaceKind}`, { exitCode: 2 });
      }
      state.surfaceKind = surfaceKind as ParsedBrokerOptions['surfaceKind'];
      index += 1;
      continue;
    }
    if (arg === '--surface-family') {
      state.surfaceFamily = requireValue(argv, index, '--surface-family');
      index += 1;
      continue;
    }
    if (arg === '--payload-digest') {
      state.payloadDigest = requireValue(argv, index, '--payload-digest');
      index += 1;
      continue;
    }
    if (arg === '--expected-task') {
      state.expectedTasks.push(requireValue(argv, index, '--expected-task'));
      index += 1;
      continue;
    }
    if (arg === '--collection-timeout-ms') {
      const parsed = Number.parseInt(requireValue(argv, index, '--collection-timeout-ms'), 10);
      state.collectionTimeoutMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 120000;
      index += 1;
      continue;
    }
    if (arg === '--surface') {
      state.surfaces.push(requireValue(argv, index, '--surface'));
      index += 1;
      continue;
    }
    if (arg === '--source-item') {
      state.sourceItems.push(requireValue(argv, index, '--source-item'));
      index += 1;
      continue;
    }
    if (arg === '--intent-file') {
      state.intentFile = requireValue(argv, index, '--intent-file');
      index += 1;
      continue;
    }
    if (arg === '--freeze-id') {
      state.freezeId = requireValue(argv, index, '--freeze-id');
      index += 1;
      continue;
    }
    if (arg === '--ttl-seconds') {
      const val = requireValue(argv, index, '--ttl-seconds');
      const parsed = parseInt(val, 10);
      state.ttlSeconds = !Number.isFinite(parsed) || parsed <= 0 ? 1800 : parsed;
      index += 1;
      continue;
    }
    if (arg === '--proposal-file') {
      state.proposalFiles.push(requireValue(argv, index, '--proposal-file'));
      index += 1;
      continue;
    }
    if (arg === '--proposal-id') {
      state.proposalIds.push(requireValue(argv, index, '--proposal-id').trim());
      index += 1;
      continue;
    }
    if (arg === '--store') {
      state.proposalStorePath = requireValue(argv, index, '--store');
      index += 1;
      continue;
    }
    if (arg === '--merge-plan-file') {
      state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
      index += 1;
      continue;
    }
    if (arg === '--scope-file') {
      state.scopeFiles.push(requireValue(argv, index, '--scope-file'));
      index += 1;
      continue;
    }
    if (arg === '--steward-id') {
      state.stewardId = requireValue(argv, index, '--steward-id');
      index += 1;
      continue;
    }
    if (arg === '--evidence-out') {
      state.evidenceOutPath = requireValue(argv, index, '--evidence-out');
      index += 1;
      continue;
    }
    if (arg === '--run-evidence-dir') {
      state.runEvidenceDir = requireValue(argv, index, '--run-evidence-dir');
      index += 1;
      continue;
    }
    if (arg === '--request-file') {
      state.requestFiles.push(requireValue(argv, index, '--request-file'));
      index += 1;
      continue;
    }
    if (arg === '--requests-dir') {
      state.requestsDir = requireValue(argv, index, '--requests-dir');
      index += 1;
      continue;
    }
    if (arg === '--apply') {
      state.apply = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `broker does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.action) {
      state.action = arg as ParsedBrokerOptions['action'];
    } else if (state.action === 'proposal' && !state.proposalAction) {
      state.proposalAction = arg as ParsedBrokerOptions['proposalAction'];
    } else if (state.action === 'proposal' && state.proposalAction && !state.proposalIdPositional) {
      state.proposalIdPositional = arg;
    } else if (state.action === 'steward' && !state.stewardAction) {
      state.stewardAction = arg as ParsedBrokerOptions['stewardAction'];
    } else if (state.action === 'runtime' && !state.runtimeAction) {
      state.runtimeAction = arg as ParsedBrokerOptions['runtimeAction'];
    } else if (state.action === 'runner-sync' && !state.runnerSyncAction) {
      state.runnerSyncAction = arg as ParsedBrokerOptions['runnerSyncAction'];
    } else if (state.action === 'projection' && !state.projectionAction) {
      state.projectionAction = arg as ParsedBrokerOptions['projectionAction'];
    } else if (state.action === 'schedule' && !state.scheduleAction) {
      state.scheduleAction = arg as ParsedBrokerOptions['scheduleAction'];
    } else {
      throw new CliError('ATM_CLI_USAGE', 'broker accepts only one action (and optional proposal subaction).', { exitCode: 2 });
    }
  }

  const proposalIds = state.proposalIds.length > 0
    ? state.proposalIds
    : state.proposalIdPositional
      ? [state.proposalIdPositional]
      : [];

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    proposalAction: state.proposalAction,
    stewardAction: state.stewardAction,
    runtimeAction: state.runtimeAction,
    runnerSyncAction: state.runnerSyncAction,
    projectionAction: state.projectionAction,
    scheduleAction: state.scheduleAction,
    task: state.task,
    actorId: state.actorId,
    sealedSourceSha: state.sealedSourceSha,
    stewardWorkId: state.stewardWorkId,
    receiptRef: state.receiptRef,
    receiptDigest: state.receiptDigest,
    projectionKey: state.projectionKey,
    waveId: state.waveId,
    surfaceKind: state.surfaceKind,
    surfaceFamily: state.surfaceFamily,
    payloadDigest: state.payloadDigest,
    expectedTasks: state.expectedTasks,
    collectionTimeoutMs: state.collectionTimeoutMs,
    intentFile: state.intentFile,
    freezeId: state.freezeId,
    ttlSeconds: state.ttlSeconds,
    surfaces: state.surfaces,
    sourceItems: state.sourceItems,
    proposalFiles: state.proposalFiles,
    proposalIds,
    proposalStorePath: state.proposalStorePath,
    mergePlanFile: state.mergePlanFile,
    scopeFiles: state.scopeFiles,
    stewardId: state.stewardId,
    evidenceOutPath: state.evidenceOutPath,
    requestFiles: state.requestFiles,
    requestsDir: state.requestsDir,
    runEvidenceDir: state.runEvidenceDir,
    apply: state.apply
  };
}

function readConfiguredBrokerRunEvidenceDir(cwd: string): string | null {
  try {
    const configPath = path.join(cwd, '.atm', 'config.json');
    if (!existsSync(configPath)) {
      return null;
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const broker = config && typeof config === 'object' ? (config as Record<string, unknown>).broker : null;
    const brokerRecord = broker && typeof broker === 'object' && !Array.isArray(broker)
      ? broker as Record<string, unknown>
      : null;
    const dir = brokerRecord?.runEvidenceDir ?? null;
    return typeof dir === 'string' && dir.trim() ? dir.trim() : null;
  } catch {
    return null;
  }
}

export function resolveBrokerRunEvidenceDir(options: ParsedBrokerOptions): string {
  const configuredDir = options.runEvidenceDir
    ?? process.env.ATM_BROKER_RUN_EVIDENCE_DIR
    ?? readConfiguredBrokerRunEvidenceDir(options.cwd)
    ?? null;
  if (configuredDir) {
    return path.resolve(options.cwd, configuredDir);
  }
  return path.resolve(options.cwd, defaultFallbackBrokerRunEvidenceRelativeDir);
}

export function normalizeEvidencePath(cwd: string, filePath: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(cwd, absolute);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? absolute.replace(/\\/g, '/')
    : relative.replace(/\\/g, '/');
}

export function loadComposeProposals(options: ParsedBrokerOptions): PatchProposal[] {
  const proposals: PatchProposal[] = [];
  const seen = new Set<string>();

  for (const proposalFile of options.proposalFiles) {
    const proposal = readBrokerProposalFile(path.resolve(options.cwd, proposalFile));
    if (!seen.has(proposal.proposalId)) {
      seen.add(proposal.proposalId);
      proposals.push(proposal);
    }
  }

  if (options.proposalStorePath || options.proposalIds.length > 0) {
    const storePath = path.join(options.cwd, options.proposalStorePath ?? defaultBrokerProposalStoreRelativePath);
    const store = loadBrokerProposalStore(storePath);
    const ids = options.proposalIds.length > 0
      ? [...options.proposalIds].sort((left, right) => left.localeCompare(right))
      : [...store.proposals].map((proposal) => proposal.proposalId).sort((left, right) => left.localeCompare(right));

    for (const proposalId of ids) {
      const proposal = findBrokerProposal(store, proposalId);
      if (!proposal) {
        throw new CliError('ATM_BROKER_PROPOSAL_NOT_FOUND', `Broker proposal not found: ${proposalId}`, {
          exitCode: 2,
          details: { proposalId, storePath: relativeStorePath(options.cwd, storePath) }
        });
      }
      if (!seen.has(proposal.proposalId)) {
        seen.add(proposal.proposalId);
        proposals.push(proposal);
      }
    }
  }

  if (proposals.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'broker compose requires --proposal-file <path> and/or --store <path> with optional --proposal-id <id>.', { exitCode: 2 });
  }

  return proposals;
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `broker requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

export function relativeStorePath(cwd: string, storePath: string): string {
  return path.relative(cwd, storePath) || path.basename(storePath);
}
