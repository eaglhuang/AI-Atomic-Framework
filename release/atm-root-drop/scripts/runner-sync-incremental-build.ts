import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { RunnerSyncAdmissionReport } from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { deriveRunnerBuildOutputInventory, type RunnerBuildOutputInventory } from '../packages/core/src/broker/runner-build-output-inventory.ts';
import {
  attestRunnerSyncPublication,
  finalizeRunnerSyncPublication,
  reconcileRunnerSyncSession,
  recordRunnerSyncBuild,
  startRunnerSyncSession,
  type ChildReceipt,
  type CoalescedGroupManifest,
  type RunnerSyncSessionPhase,
  type RunnerSyncSessionState
} from '../packages/core/src/broker/runner-sync-session.ts';
import {
  RUNNER_INPUT_GRAPH_SCHEMA,
  type RunnerInputGraph
} from '../packages/core/src/broker/runner-version-contract.ts';
import type { BuildDecision, BuildTarget, SealedBuildTimings } from './run-sealed-runner-build.ts';
import { buildRunnerSyncBuildObservation, summarizeDominantPhase } from './runner-sync-observability.ts';
import { buildRunnerSyncReleaseCommand, resolveRunnerSyncReceiptOwnerTaskId, resolveTemporaryStewardLinks, uniqueReceiptTaskIds } from './runner-sync-receipt-continuation.ts';
import { digestJson, syncDirectoryHashChanged, writeJsonWithRetry } from './runner-sync-artifact-filesystem.ts';
export { digestJson, syncDirectoryHashChanged, writeJsonWithRetry } from './runner-sync-artifact-filesystem.ts';
export { buildRunnerSyncBuildObservation, persistTsBuildCache, prepareTsBuildCache, summarizeDominantPhase, writeRunnerBuildRuntimeTelemetry } from './runner-sync-observability.ts';
const releaseManifestPaths = [
  path.join('release', 'atm-root-drop', 'release-manifest.json'),
  path.join('release', 'atm-onefile', 'release-manifest.json')
] as const;

const buildInputPaths = [
  'packages',
  'scripts',
  'templates',
  'schemas',
  'atomic_workbench',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json'
] as const;

export type RunnerIncrementalBuildPlan = {
  readonly schemaId: 'atm.runnerIncrementalBuildPlan.v1';
  readonly specVersion: '0.1.0';
  readonly previousSealedSourceSha: string | null;
  readonly currentSealedSourceSha: string;
  readonly changedPaths: readonly string[];
  readonly affectedPackages: readonly string[];
  readonly affectedGroups: {
    readonly packages: readonly string[];
    readonly scripts: readonly string[];
    readonly templates: readonly string[];
    readonly schemas: readonly string[];
    readonly atomicWorkbench: readonly string[];
    readonly rootConfig: readonly string[];
    readonly unknown: readonly string[];
  };
  readonly incrementalEligible: boolean;
  readonly unsafeReasons: readonly string[];
};
export type TsBuildCacheSummary = {
  readonly schemaId: 'atm.runnerTsBuildCacheSummary.v1';
  readonly cacheRoot: string;
  readonly tsBuildInfoPath: string;
  readonly existedBefore: boolean;
  readonly existsAfter: boolean;
  readonly digestBefore: string | null;
  readonly digestAfter: string | null;
  readonly restoredBeforeBuild: boolean;
  readonly persistedAfterBuild: boolean;
  readonly gitPolicy: {
    readonly rawCacheCommitted: false;
    readonly storage: '.atm/runtime/runner-sync-build-cache/typescript/**';
  };
};

export type RunnerSyncDominantPhaseSummary = {
  readonly schemaId: 'atm.runnerSyncDominantPhaseSummary.v1';
  readonly dominantPhase: keyof ReturnType<typeof phaseTimingsRecord>;
  readonly dominantPhaseMs: number;
  readonly totalElapsedMs: number;
  readonly dominanceRatio: number;
  readonly phaseMedianMs: number;
  readonly phaseP95Ms: number;
  readonly measuredPhaseCount: number;
  readonly optimizationVerdict: 'improved' | 'inconclusive';
  readonly basis: 'single-run' | 'ab-ba';
};

export type RunnerSyncBuildObservation = {
  readonly schemaId: 'atm.runnerSyncBuildObservation.v1';
  readonly buildDecision: 'built' | 'cacheHitSkip' | 'incrementalBuild' | 'fullRebuild';
  readonly decisionReason: string;
  readonly brokerTicket: {
    readonly ticketId: string;
    readonly waitedMs: number;
    readonly position: number;
    readonly headOwner: string | null;
  } | null;
  readonly changedPathCount: number;
  readonly affectedPackageCount: number;
  readonly unsafeReasons: readonly string[];
  readonly dominantPhaseSummary: RunnerSyncDominantPhaseSummary;
};

type RunnerSyncPhaseTimings = ReturnType<typeof phaseTimingsRecord>;

export type RunnerSyncReceipt = {
  readonly schemaId: 'atm.runnerSyncReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  /** Published sealed output or a receipt-backed retention of foreign output. */
  readonly publicationDisposition: 'published' | 'recovery-retained';
  readonly actorId: string;
  readonly actorIdentity: {
    readonly actorId: string;
    readonly source: 'ATM_ACTOR_ID' | 'AGENT_IDENTITY' | 'fallback' | 'explicit';
  };
  readonly stewardWorkId: string;
  readonly sealedSourceSha: string;
  /** Immutable publication membership for the sealed build, not a best-effort diff. */
  readonly outputInventory: RunnerBuildOutputInventory;
  readonly memberTaskIds: readonly string[];
  /** Durable task continuations represented by a temporary framework steward. */
  readonly linkedTaskIds: readonly string[];
  readonly groupManifest: CoalescedGroupManifest;
  readonly childReceipts: readonly ChildReceipt[];
  readonly childAttribution: {
    readonly schemaId: 'atm.runnerSyncChildAttribution.v1';
    readonly complete: boolean;
    readonly members: readonly {
      readonly taskId: string;
      readonly actorId: string;
      readonly laneFingerprint: string | null;
      readonly childReceiptDigest: string | null;
    }[];
    readonly missingTaskIds: readonly string[];
  };
  readonly lifecycle: {
    readonly schemaId: 'atm.runnerSyncReceiptLifecycle.v1';
    readonly durableStates: readonly RunnerSyncSessionPhase[];
    readonly provisionalState: 'built-provisional';
    readonly publicationReadyState: 'publication-ready';
    readonly terminalState: 'published' | 'reconciled';
    readonly releasePhase: RunnerSyncSessionPhase;
    readonly reconcilePhase: RunnerSyncSessionPhase;
    readonly finalizable: boolean;
    readonly recoveryCommand: string | null;
  };
  readonly runnerInputTreeHash: string;
  readonly runnerInputGraph: RunnerInputGraph;
  readonly requestedSurfaces: readonly string[];
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef: string | null;
  readonly tsBuildCache: TsBuildCacheSummary | null;
  readonly brokerTicket: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary: RunnerSyncDominantPhaseSummary;
  readonly buildObservation: RunnerSyncBuildObservation;
  readonly phaseTimingsMs: RunnerSyncPhaseTimings;
  readonly atomicWrite: {
    readonly schemaId: 'atm.runnerSyncAtomicWrite.v1';
    readonly strategy: 'temp-file-rename-with-retry';
    readonly platform: NodeJS.Platform;
    readonly maxAttempts: number;
  };
  readonly autoReleaseCommand: string;
  readonly treatmentTelemetry: {
    readonly schemaId: 'atm.generatedWriteTreatmentTelemetry.v1';
    readonly executionMode: 'cache-hit-skip' | 'command-executed';
    readonly commandExecuted: boolean;
    readonly outputObserved: boolean;
    readonly receiptValidity: 'valid';
    readonly buildDecision: BuildDecision;
    readonly phaseTimingsMs: RunnerSyncPhaseTimings;
    readonly rawTelemetryPolicy: 'gitignored-runtime-only';
    readonly tsBuildCacheDigest: string | null;
  };
  readonly publishedAt: string;
};

export function planRunnerIncrementalBuild(input: {
  readonly cwd: string;
  readonly currentSealedSourceSha: string;
  readonly previousSealedSourceSha?: string | null;
}): RunnerIncrementalBuildPlan {
  const previousSealedSourceSha = input.previousSealedSourceSha ?? readPreviousSealedSourceSha(input.cwd);
  const changedPaths = previousSealedSourceSha
    ? readChangedBuildInputPaths(input.cwd, previousSealedSourceSha, input.currentSealedSourceSha)
    : [];
  const affectedGroups = {
    packages: [] as string[],
    scripts: [] as string[],
    templates: [] as string[],
    schemas: [] as string[],
    atomicWorkbench: [] as string[],
    rootConfig: [] as string[],
    unknown: [] as string[]
  };
  const affectedPackages = new Set<string>();
  const unsafeReasons = new Set<string>();
  for (const relativePath of changedPaths) {
    const normalized = relativePath.replace(/\\/g, '/');
    const packageMatch = normalized.match(/^packages\/([^/]+)\//);
    if (packageMatch) {
      const packageDir = `packages/${packageMatch[1]}`;
      affectedGroups.packages.push(normalized);
      affectedPackages.add(packageDir);
    } else if (normalized.startsWith('scripts/')) {
      affectedGroups.scripts.push(normalized);
      unsafeReasons.add('build-script-change');
    } else if (normalized.startsWith('templates/')) {
      affectedGroups.templates.push(normalized);
    } else if (normalized.startsWith('schemas/')) {
      affectedGroups.schemas.push(normalized);
    } else if (normalized.startsWith('atomic_workbench/')) {
      affectedGroups.atomicWorkbench.push(normalized);
    } else if (['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(normalized)) {
      affectedGroups.rootConfig.push(normalized);
      unsafeReasons.add('root-config-change');
    } else {
      affectedGroups.unknown.push(normalized);
      unsafeReasons.add('unknown-build-input');
    }
  }
  if (!previousSealedSourceSha) unsafeReasons.add('missing-previous-sealed-source');
  return {
    schemaId: 'atm.runnerIncrementalBuildPlan.v1',
    specVersion: '0.1.0',
    previousSealedSourceSha,
    currentSealedSourceSha: input.currentSealedSourceSha,
    changedPaths,
    affectedPackages: [...affectedPackages].sort(),
    affectedGroups: {
      packages: affectedGroups.packages.sort(),
      scripts: affectedGroups.scripts.sort(),
      templates: affectedGroups.templates.sort(),
      schemas: affectedGroups.schemas.sort(),
      atomicWorkbench: affectedGroups.atomicWorkbench.sort(),
      rootConfig: affectedGroups.rootConfig.sort(),
      unknown: affectedGroups.unknown.sort()
    },
    incrementalEligible: changedPaths.length > 0 && affectedPackages.size > 0 && unsafeReasons.size === 0,
    unsafeReasons: [...unsafeReasons].sort()
  };
}

export function buildRunnerSyncReceipt(input: {
  readonly admission: RunnerSyncAdmissionReport;
  readonly actorId: string;
  readonly actorIdentitySource?: RunnerSyncReceipt['actorIdentity']['source'];
  readonly sealedSourceSha: string;
  readonly linkedTaskIds?: readonly string[];
  readonly outputInventory?: RunnerBuildOutputInventory;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason?: string;
  readonly publicationDisposition?: RunnerSyncReceipt['publicationDisposition'];
  readonly incrementalPlan?: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef?: string | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
  readonly receiptTaskId?: string | null;
  readonly timings: SealedBuildTimings;
  readonly publishedAt?: string;
}): RunnerSyncReceipt {
  const queueTaskId = input.admission.queueHeadOwnership.waitingTasks[0] || '';
  const taskId = input.receiptTaskId?.trim() || queueTaskId;
  const stewardWorkId = input.admission.queueHeadOwnership.stewardWorkId ?? '';
  if (!queueTaskId || !taskId || !stewardWorkId) {
    throw new Error('ATM_RUNNER_SYNC_RECEIPT_INVALID: queue-head task and steward work id are required to publish a runner-sync receipt.');
  }
  const brokerTicket = input.brokerTicket ?? normalizeBrokerTicket(input.admission);
  const runnerInputGraph = buildReceiptRunnerInputGraph(input.sealedSourceSha, input.buildInputsTreeHash, input.admission.runnerSyncSteward?.requestedSurfaces ?? []);
  const session = buildReceiptSession({
    admission: input.admission,
    stewardWorkId,
    sealedSourceSha: input.sealedSourceSha,
    runnerInputTreeHash: input.buildInputsTreeHash,
    runnerInputGraph,
    sharedOutputDigest: digestJson({
      buildTarget: input.buildTarget,
      buildInputsTreeHash: input.buildInputsTreeHash,
      buildDecision: input.buildDecision,
      requestedSurfaces: input.admission.runnerSyncSteward?.requestedSurfaces ?? []
    }),
    issuedAt: input.publishedAt ?? new Date().toISOString()
  });
  return {
    schemaId: 'atm.runnerSyncReceipt.v1',
    specVersion: '0.1.0',
    taskId,
    publicationDisposition: input.publicationDisposition ?? 'published',
    actorId: input.actorId,
    actorIdentity: {
      actorId: input.actorId,
      source: input.actorIdentitySource ?? 'explicit'
    },
    stewardWorkId,
    sealedSourceSha: input.sealedSourceSha,
    outputInventory: input.outputInventory ?? deriveRunnerBuildOutputInventory({
      sealedSourceSha: input.sealedSourceSha,
      observedPaths: [],
      currentTaskId: taskId
    }),
    memberTaskIds: session.release.state.groupManifest.memberTaskIds,
    linkedTaskIds: uniqueReceiptTaskIds(input.linkedTaskIds ?? []),
    groupManifest: session.release.state.groupManifest,
    childReceipts: session.release.state.childReceipts,
    childAttribution: buildChildAttribution(session.release.state),
    lifecycle: {
      schemaId: 'atm.runnerSyncReceiptLifecycle.v1',
      durableStates: ['building', 'built-provisional', 'publication-ready', 'published', 'reconciled'],
      provisionalState: 'built-provisional',
      publicationReadyState: 'publication-ready',
      terminalState: session.reconcile.state.phase === 'reconciled' ? 'reconciled' : 'published',
      releasePhase: session.release.state.phase,
      reconcilePhase: session.reconcile.state.phase,
      finalizable: session.release.allowed && session.release.state.phase === 'published' && session.reconcile.allowed,
      recoveryCommand: session.release.recoveryCommand ?? session.reconcile.recoveryCommand
    },
    runnerInputTreeHash: input.buildInputsTreeHash,
    runnerInputGraph,
    requestedSurfaces: [...input.admission.runnerSyncSteward?.requestedSurfaces ?? []].sort(),
    buildTarget: input.buildTarget,
    buildInputsTreeHash: input.buildInputsTreeHash,
    buildDecision: input.buildDecision,
    decisionReason: input.decisionReason ?? '',
    incrementalPlan: input.incrementalPlan ?? null,
    runtimeTelemetryRef: input.runtimeTelemetryRef ?? null,
    tsBuildCache: input.tsBuildCache ?? null,
    brokerTicket,
    dominantPhaseSummary: input.dominantPhaseSummary ?? summarizeDominantPhase(input.timings),
    buildObservation: buildRunnerSyncBuildObservation({
      buildDecision: input.buildDecision,
      decisionReason: input.decisionReason ?? '',
      incrementalPlan: input.incrementalPlan ?? null,
      timings: input.timings,
      brokerTicket
    }),
    phaseTimingsMs: phaseTimingsRecord(input.timings),
    atomicWrite: {
      schemaId: 'atm.runnerSyncAtomicWrite.v1',
      strategy: 'temp-file-rename-with-retry',
      platform: process.platform,
      maxAttempts: 4
    },
    autoReleaseCommand: buildRunnerSyncReleaseCommand({
      taskId: queueTaskId,
      stewardWorkId,
      receiptRef: path.join('.atm', 'history', 'evidence', `${taskId}.runner-sync-receipt.json`).replace(/\\/g, '/')
    }),
    treatmentTelemetry: {
      schemaId: 'atm.generatedWriteTreatmentTelemetry.v1',
      executionMode: input.buildDecision === 'cacheHitSkip' ? 'cache-hit-skip' : 'command-executed',
      commandExecuted: input.buildDecision !== 'cacheHitSkip',
      outputObserved: true,
      receiptValidity: 'valid',
      buildDecision: input.buildDecision,
      phaseTimingsMs: phaseTimingsRecord(input.timings),
      rawTelemetryPolicy: 'gitignored-runtime-only',
      tsBuildCacheDigest: input.tsBuildCache ? digestJson(input.tsBuildCache) : null
    },
    publishedAt: input.publishedAt ?? new Date().toISOString()
  };
}

function buildReceiptSession(input: {
  readonly admission: RunnerSyncAdmissionReport;
  readonly stewardWorkId: string;
  readonly sealedSourceSha: string;
  readonly runnerInputTreeHash: string;
  readonly runnerInputGraph: RunnerInputGraph;
  readonly sharedOutputDigest: string;
  readonly issuedAt: string;
}) {
  const ports = { now: () => input.issuedAt };
  const requests = input.admission.runnerSyncSteward?.requests ?? [];
  const members = requests.length > 0
    ? requests.map((request) => ({ taskId: request.taskId, actorId: request.actorId, laneSessionId: null, requestedSurfaces: request.requestedSurfaces }))
    : input.admission.queueHeadOwnership.waitingTasks.map((taskId) => ({
        taskId, actorId: input.admission.stewardActorId || 'runner-sync-steward', laneSessionId: null,
        requestedSurfaces: input.admission.runnerSyncSteward?.requestedSurfaces ?? []
      }));
  const started = startRunnerSyncSession({
    stewardWorkId: input.stewardWorkId,
    sealedSourceSha: input.sealedSourceSha,
    members,
    sharedSealedInputDigest: input.runnerInputTreeHash
  }, ports);
  if (!started.allowed) throw new Error(`ATM_RUNNER_SYNC_RECEIPT_INVALID: ${started.reason}`);
  const recorded = recordRunnerSyncBuild(started.state, {
    sharedOutputDigest: input.sharedOutputDigest,
    inputGraph: input.runnerInputGraph
  }, ports);
  if (!recorded.allowed) throw new Error(`ATM_RUNNER_SYNC_RECEIPT_INVALID: ${recorded.reason}`);
  const attested = attestRunnerSyncPublication(recorded.state, ports);
  if (!attested.allowed) throw new Error(`ATM_RUNNER_SYNC_RECEIPT_INVALID: ${attested.reason}`);
  const release = finalizeRunnerSyncPublication(attested.state, {
    currentHead: input.sealedSourceSha,
    headDeltaPaths: []
  }, ports);
  if (!release.allowed) throw new Error(`ATM_RUNNER_SYNC_RECEIPT_INVALID: ${release.reason}`);
  const reconcile = reconcileRunnerSyncSession(recorded.state, {
    currentHead: input.sealedSourceSha,
    headDeltaPaths: []
  }, ports);
  return { release, reconcile };
}

function buildChildAttribution(session: RunnerSyncSessionState): RunnerSyncReceipt['childAttribution'] {
  const receiptsByTask = new Map(session.childReceipts.map((receipt) => [receipt.taskId, receipt]));
  const missingTaskIds = session.groupManifest.memberTaskIds.filter((taskId) => !receiptsByTask.has(taskId));
  return {
    schemaId: 'atm.runnerSyncChildAttribution.v1',
    complete: missingTaskIds.length === 0 && session.groupManifest.memberTaskIds.length > 0,
    members: session.groupManifest.members.map((member) => ({
      taskId: member.taskId,
      actorId: member.actorId,
      laneFingerprint: member.laneFingerprint,
      childReceiptDigest: receiptsByTask.get(member.taskId)?.receiptDigest ?? null
    })),
    missingTaskIds
  };
}

function buildReceiptRunnerInputGraph(
  sealedSourceSha: string,
  aggregateInputTreeHash: string,
  requestedSurfaces: readonly string[]
): RunnerInputGraph {
  return {
    schemaId: RUNNER_INPUT_GRAPH_SCHEMA,
    sealedSourceSha,
    aggregateInputTreeHash,
    nodes: [{
      segment: 'packages',
      inputPaths: [...buildInputPaths].sort(),
      inputDigest: aggregateInputTreeHash,
      outputEntries: [...requestedSurfaces].sort(),
      outputDigest: digestJson({ sealedSourceSha, aggregateInputTreeHash, requestedSurfaces: [...requestedSurfaces].sort() })
    }]
  };
}

export function writeRunnerSyncReceipt(input: {
  readonly cwd: string;
  readonly admission: RunnerSyncAdmissionReport;
  readonly actorId: string;
  readonly actorIdentitySource?: RunnerSyncReceipt['actorIdentity']['source'];
  readonly sealedSourceSha: string;
  readonly linkedTaskIds?: readonly string[];
  readonly outputInventory?: RunnerBuildOutputInventory;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason?: string;
  readonly publicationDisposition?: RunnerSyncReceipt['publicationDisposition'];
  readonly incrementalPlan?: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef?: string | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
  readonly timings: SealedBuildTimings;
}): string {
  const linkedTaskIds = uniqueReceiptTaskIds([
    ...(input.linkedTaskIds ?? []),
    ...resolveTemporaryStewardLinks(input.cwd, input.admission.queueHeadOwnership.waitingTasks)
  ]);
  const receipt = buildRunnerSyncReceipt({
    ...input,
    linkedTaskIds,
    receiptTaskId: resolveRunnerSyncReceiptOwnerTaskId(input.cwd, input.admission.queueHeadOwnership.waitingTasks)
  });
  const relative = path.join('.atm', 'history', 'evidence', `${receipt.taskId}.runner-sync-receipt.json`);
  const absolute = path.join(input.cwd, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeJsonWithRetry({ filePath: absolute, value: receipt });
  return relative.replace(/\\/g, '/');
}

export { buildRunnerSyncReleaseCommand } from './runner-sync-receipt-continuation.ts';

export function phaseTimingsRecord(timings: SealedBuildTimings): {
  readonly inputHashCalculation: number;
  readonly skipDecision: number;
  readonly worktreeSetup: number;
  readonly typescriptBuild: number;
  readonly rootDropReleaseAssembly: number;
  readonly onefileReleaseAssembly: number;
  readonly artifactSync: number;
  readonly cleanup: number;
  readonly totalElapsed: number;
} {
  return {
    inputHashCalculation: timings.inputHashCalculationMs,
    skipDecision: timings.skipDecisionMs,
    worktreeSetup: timings.worktreeSetupMs,
    typescriptBuild: timings.typescriptBuildMs,
    rootDropReleaseAssembly: timings.rootDropAssemblyMs,
    onefileReleaseAssembly: timings.onefileAssemblyMs,
    artifactSync: timings.artifactSyncMs,
    cleanup: timings.cleanupMs,
    totalElapsed: timings.totalElapsedMs
  };
}

function readPreviousSealedSourceSha(cwd: string): string | null {
  for (const relative of releaseManifestPaths) {
    const absolute = path.join(cwd, relative);
    if (!existsSync(absolute)) continue;
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    const value = typeof parsed.sealedSourceCommit === 'string' ? parsed.sealedSourceCommit.trim() : '';
    if (value) return value;
  }
  return null;
}

function readChangedBuildInputPaths(cwd: string, previous: string, current: string): readonly string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${previous}..${current}`, '--', ...buildInputPaths], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0 || result.error) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).sort();
}

function normalizeBrokerTicket(admission: RunnerSyncAdmissionReport): RunnerSyncBuildObservation['brokerTicket'] {
  const ticket = admission.brokerTicket;
  if (!ticket) return null;
  return {
    ticketId: ticket.ticketId,
    waitedMs: ticket.waitedMs,
    position: ticket.position,
    headOwner: ticket.headOwner
  };
}
