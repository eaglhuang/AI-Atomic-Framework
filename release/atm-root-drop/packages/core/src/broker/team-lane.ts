import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { calculateBrokerDecision } from './decision.ts';
import { buildVirtualAtomInUseRegistry, cleanupStale, loadRegistry } from './registry.ts';
import { readGitHeadCommit } from './steward.ts';
import type { BrokerDecision, MergeVerdict, MutationRequest, BrokerOperationRunRecord, BrokerOperationRunRecordEnvelope } from './types.ts';
import type {
  ProposalAdmissionBoundedRegion,
  ProposalAdmissionEvidence,
  ProposalAdmissionRequest,
  WriteIntent,
  WriteIntentAtomRef
} from './types.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';

export const DEFAULT_TEAM_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';
const HOT_FILE_BASENAMES = new Set(['tasks.ts', 'next.ts', 'evidence.ts', 'hook.ts', 'team.ts', 'broker.ts']);

export type TeamBrokerChosenLane =
  | 'direct-brokered'
  | 'deterministic-composer'
  | 'neutral-steward'
  | 'serial'
  | 'blocked';

export interface TeamBrokerLaneEvidence {
  readonly schemaId: 'atm.teamBrokerLaneEvidence.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly registryPath: string;
  readonly writeIntent: WriteIntent;
  readonly writeTransaction: TeamBrokerWriteTransactionEvidence;
  readonly decision: BrokerDecision;
  readonly admission: ProposalAdmissionEvidence;
  readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
  readonly chosenLane: TeamBrokerChosenLane;
  readonly stewardId: string | null;
  readonly composerPath: string | null;
  readonly safeToStart: boolean;
  readonly blockedReasons: readonly string[];
}

export interface TeamBrokerLaneResult {
  readonly ok: boolean;
  readonly evidence: TeamBrokerLaneEvidence;
}

export interface TeamBrokerWriteTransactionEvidence {
  readonly schemaId: 'atm.teamBrokerWriteTransaction.v1';
  readonly transactionId: string;
  readonly taskId: string;
  readonly principalId: string;
  readonly actorId: string;
  readonly sessionId: string | null;
  readonly instanceId: string;
  readonly worktreeId: string;
  readonly branchRef: string | null;
  readonly baseHead: string;
  readonly leaseEpoch: number;
  readonly allowedFiles: readonly string[];
  readonly readSet: readonly string[];
  readonly writeSet: readonly string[];
  readonly fileHashesBefore: Record<string, string | null>;
  readonly brokerDecision: {
    readonly verdict: BrokerDecision['verdict'];
    readonly lane: BrokerDecision['lane'];
    readonly intentId: string;
    readonly parallelSafetyReason: 'no-known-textual-or-resource-conflict' | null;
  };
  readonly admissionState: ProposalAdmissionEvidence['state'];
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
}

export interface TeamBrokerRuntimeActivationHandshakeEvidence {
  readonly schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly registryPath: string;
  readonly brokerLane: TeamBrokerLaneEvidence;
  readonly activationState: 'activated' | 'blocked';
  readonly scopedWriteExecution: {
    readonly approved: boolean;
    readonly allowedFiles: readonly string[];
    readonly evidencePath: string | null;
    readonly acceptedInputs: readonly ['PatchProposal', 'MergePlan', 'StewardPlan'];
  };
  readonly runtimeBoundary: {
    readonly gitWrite: false;
    readonly taskLifecycle: false;
    readonly selfClose: false;
  };
  readonly blockedReasons: readonly string[];
}

export interface TeamBrokerRuntimeActivationHandshakeResult {
  readonly ok: boolean;
  readonly evidence: TeamBrokerRuntimeActivationHandshakeEvidence;
}

export interface TeamBrokerFinding {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly detail: string;
  readonly paths?: string[];
}

export interface BrokerRunRecordInput {
  readonly runId: string;
  readonly planId: string;
  readonly request: MutationRequest;
  readonly adapterChoice: string;
  readonly laneDecision: string;
  readonly mergeVerdict: MergeVerdict;
  readonly evidencePath: string;
  readonly appliedFiles?: readonly string[];
  readonly commitSha?: string | null;
  readonly transactionIds?: readonly string[];
}

export function buildTeamBrokerRunRecord(input: BrokerRunRecordInput): BrokerOperationRunRecord {
  const taskId = input.request.taskId?.trim();
  const transactionIds = normalizeStringList(input.transactionIds ?? []);
  return {
    schemaId: 'atm.brokerOperationRunRecord.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'team lane run record'
    },
    runId: input.runId,
    planId: input.planId,
    request_identity: [input.request.requestId],
    actor_ids: [input.request.actorId],
    request_files: [input.request.filePath],
    adapter_choice: input.adapterChoice,
    applied_files: input.appliedFiles ?? [input.request.filePath],
    lane_decision: input.laneDecision,
    merge_verdict: input.mergeVerdict,
    evidence_path: input.evidencePath,
    ...(taskId ? { task_ids: [taskId] } : {}),
    ...(input.commitSha ? { commit_sha: input.commitSha } : {}),
    ...(transactionIds.length > 0 ? { transaction_ids: transactionIds } : {})
  };
}

export function buildTeamBrokerRunRecordEnvelope(input: {
  readonly runId: string;
  readonly planId: string;
  readonly records: readonly BrokerOperationRunRecord[];
}): BrokerOperationRunRecordEnvelope {
  return {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'team lane run record'
    },
    runId: input.runId,
    planId: input.planId,
    records: [...input.records]
  };
}

export function buildTeamWriteIntent(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
}): WriteIntent {
  const task = input.task as Record<string, unknown> | null;
  const baseCommit = readGitHeadCommit(path.resolve(input.cwd)) ?? 'unknown-base-commit';
  const targetFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const hotFiles = targetFiles.filter((entry) => HOT_FILE_BASENAMES.has(path.posix.basename(entry)));
  const proposalAdmission = deriveTeamProposalAdmission(task, hotFiles);

  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'team plan/start broker lane' },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit,
    targetFiles,
    atomRefs: deriveTeamAtomRefs(task, input.taskId),
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto',
    ...(proposalAdmission ? { proposalAdmission } : {})
  };
}

export function resolveTeamBrokerLane(decision: BrokerDecision): {
  readonly chosenLane: TeamBrokerChosenLane;
  readonly stewardId: string | null;
  readonly composerPath: string | null;
  readonly safeToStart: boolean;
  readonly blockedReasons: readonly string[];
} {
  if (decision.admission?.state === 'proposal-submitted') {
    return {
      chosenLane: 'direct-brokered',
      stewardId: null,
      composerPath: null,
      safeToStart: false,
      blockedReasons: [decision.admission.reason]
    };
  }

  if (
    decision.verdict === 'blocked-cid-conflict'
    || decision.verdict === 'blocked-shared-surface'
    || decision.verdict === 'blocked-active-lease'
    || decision.lane === 'blocked'
  ) {
    return {
      chosenLane: 'blocked',
      stewardId: null,
      composerPath: null,
      safeToStart: false,
      blockedReasons: [
        decision.reason,
        ...decision.conflicts.map((conflict) => conflict.detail)
      ]
    };
  }

  if (decision.verdict === 'needs-physical-split') {
    return {
      chosenLane: 'neutral-steward',
      stewardId: DEFAULT_TEAM_STEWARD_ID,
      composerPath: 'broker compose -> steward plan/apply',
      safeToStart: true,
      blockedReasons: []
    };
  }

  if (decision.lane === 'deterministic-composer') {
    return {
      chosenLane: 'deterministic-composer',
      stewardId: null,
      composerPath: 'broker compose',
      safeToStart: true,
      blockedReasons: []
    };
  }

  return {
    chosenLane: decision.lane === 'serial' ? 'serial' : 'direct-brokered',
    stewardId: null,
    composerPath: null,
    safeToStart: true,
    blockedReasons: []
  };
}

export function evaluateTeamBrokerLane(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
  readonly registryPath?: string;
}): TeamBrokerLaneResult {
  const registryPath = input.registryPath ?? path.join(path.resolve(input.cwd), DEFAULT_BROKER_REGISTRY_RELATIVE_PATH);
  const writeIntent = buildTeamWriteIntent(input);
  const registry = cleanupStale(loadRegistry(registryPath));
  const virtualAtomInUseRegistry = buildVirtualAtomInUseRegistry(registry);
  const decision = calculateBrokerDecision(writeIntent, registry);
  const resolution = resolveTeamBrokerLane(decision);
  const writeTransaction = buildTeamBrokerWriteTransactionEvidence({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    writeIntent,
    decision,
    writePaths: input.writePaths
  });
  const admission = decision.admission ?? {
    trigger: 'not-required',
    state: 'not-required',
    requiresProposal: false,
    summarySubmitted: false,
    hotFiles: [],
    boundedRegions: [],
    rearbitrationRequired: false,
    reason: 'No proposal admission evidence was emitted.'
  };

  const evidence: TeamBrokerLaneEvidence = {
    schemaId: 'atm.teamBrokerLaneEvidence.v1',
    specVersion: '0.1.0',
    taskId: input.taskId,
    actorId: input.actorId,
    registryPath: DEFAULT_BROKER_REGISTRY_RELATIVE_PATH,
    writeIntent,
    writeTransaction,
    decision,
    admission,
    virtualAtomInUseRegistry,
    chosenLane: resolution.chosenLane,
    stewardId: resolution.stewardId,
    composerPath: resolution.composerPath,
    safeToStart: resolution.safeToStart,
    blockedReasons: resolution.blockedReasons
  };

  return {
    ok: resolution.safeToStart,
    evidence
  };
}

export function buildTeamBrokerEvidence(result: TeamBrokerLaneResult): TeamBrokerLaneEvidence {
  return result.evidence;
}

export function buildTeamBrokerWriteTransactionEvidence(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly writeIntent: WriteIntent;
  readonly decision: BrokerDecision;
  readonly writePaths: readonly string[];
}): TeamBrokerWriteTransactionEvidence {
  const cwd = path.resolve(input.cwd);
  const allowedFiles = normalizePathList(input.writePaths);
  const readSet = normalizePathList([
    ...allowedFiles,
    ...input.writeIntent.atomRefs.map((ref) => ref.sourceRange?.filePath ?? '').filter(Boolean)
  ]);
  const writeSet = normalizePathList(input.writeIntent.targetFiles);
  const startedAt = new Date().toISOString();
  const leaseEpoch = Date.now();
  const leaseSeconds = Math.max(1, Math.floor(input.writeIntent.leaseBounds?.requestedSeconds ?? 1800));
  const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const transactionSeed = [
    input.taskId,
    input.actorId,
    input.writeIntent.baseCommit,
    input.decision.intentId,
    leaseEpoch,
    ...writeSet
  ].join('\n');

  return {
    schemaId: 'atm.teamBrokerWriteTransaction.v1',
    transactionId: `txn-${createHash('sha256').update(transactionSeed).digest('hex').slice(0, 16)}`,
    taskId: input.taskId,
    principalId: input.actorId,
    actorId: input.actorId,
    sessionId: readSessionId(),
    instanceId: `${input.actorId}@local`,
    worktreeId: cwd,
    branchRef: readGitBranchRef(cwd),
    baseHead: input.writeIntent.baseCommit,
    leaseEpoch,
    allowedFiles,
    readSet,
    writeSet,
    fileHashesBefore: buildFileHashesBefore(cwd, writeSet),
    brokerDecision: {
      verdict: input.decision.verdict,
      lane: input.decision.lane,
      intentId: input.decision.intentId,
      parallelSafetyReason: input.decision.verdict === 'parallel-safe'
        ? 'no-known-textual-or-resource-conflict'
        : null
    },
    admissionState: input.decision.admission?.state ?? 'not-required',
    startedAt,
    expiresAt,
    heartbeatAt: startedAt
  };
}

function readSessionId(): string | null {
  for (const key of ['ATM_SESSION_ID', 'CODEX_SESSION_ID', 'GITHUB_RUN_ID']) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function readGitBranchRef(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const branch = String(result.stdout ?? '').trim();
  return branch || null;
}

function normalizePathList(entries: readonly string[]): readonly string[] {
  return normalizeStringList(entries.map((entry) => entry.replace(/\\/g, '/')));
}

function normalizeStringList(entries: readonly string[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.replace(/\\/g, '/').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function buildFileHashesBefore(cwd: string, relativePaths: readonly string[]): Record<string, string | null> {
  const output: Record<string, string | null> = {};
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(cwd, relativePath);
    output[relativePath] = existsSync(absolutePath)
      ? `sha256:${createHash('sha256').update(readFileSync(absolutePath)).digest('hex')}`
      : null;
  }
  return output;
}

export function buildTeamBrokerRuntimeActivationHandshake(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
  readonly registryPath?: string;
  readonly evidencePath?: string | null;
}): TeamBrokerRuntimeActivationHandshakeResult {
  const laneResult = evaluateTeamBrokerLane(input);
  const approved = laneResult.ok && laneResult.evidence.safeToStart;
  const allowedFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  const evidence: TeamBrokerRuntimeActivationHandshakeEvidence = {
    schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1',
    specVersion: '0.1.0',
    taskId: input.taskId,
    actorId: input.actorId,
    registryPath: laneResult.evidence.registryPath,
    brokerLane: laneResult.evidence,
    activationState: approved ? 'activated' : 'blocked',
    scopedWriteExecution: {
      approved,
      allowedFiles,
      evidencePath: input.evidencePath ?? null,
      acceptedInputs: ['PatchProposal', 'MergePlan', 'StewardPlan']
    },
    runtimeBoundary: {
      gitWrite: false,
      taskLifecycle: false,
      selfClose: false
    },
    blockedReasons: approved ? [] : [...laneResult.evidence.blockedReasons]
  };

  return {
    ok: approved,
    evidence
  };
}

export function brokerLaneToFindings(result: TeamBrokerLaneResult): TeamBrokerFinding[] {
  if (result.ok) {
    return [];
  }

  const { decision, blockedReasons } = result.evidence;
  const code = decision.verdict === 'blocked-shared-surface'
    ? 'blocked-broker-shared-surface'
    : 'blocked-broker-cid-conflict';

  return [{
    level: 'error',
    code,
    detail: blockedReasons[0] ?? decision.reason,
    paths: decision.conflicts
      .filter((conflict) => conflict.kind === 'file-range')
      .map((conflict) => {
        const match = /'([^']+)'/.exec(conflict.detail);
        return match?.[1] ?? '';
      })
      .filter(Boolean)
  }];
}

function deriveTeamAtomRefs(task: Record<string, unknown> | null, taskId: string): WriteIntentAtomRef[] {
  const atomizationImpact = task?.atomizationImpact as Record<string, unknown> | undefined;
  const ownerAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? taskId).trim();
  const atomCid = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const firstRegion = deriveBoundedRegions(task)[0];
  return [{
    atomId: ownerAtom,
    atomCid,
    operation: 'modify',
    ...(firstRegion ? {
      sourceRange: {
        filePath: firstRegion.filePath,
        lineStart: firstRegion.lineStart,
        lineEnd: firstRegion.lineEnd
      }
    } : {})
  }];
}

function deriveTeamProposalAdmission(
  task: Record<string, unknown> | null,
  hotFiles: readonly string[]
): ProposalAdmissionRequest | undefined {
  const raw =
    asRecord(task?.proposalAdmission)
    ?? asRecord(task?.brokerProposalAdmission)
    ?? asRecord(task?.writeAdmission);
  const boundedRegions = deriveBoundedRegions(task);
  const configuredTrigger = normalizeProposalTrigger(raw?.trigger);
  const notes = typeof raw?.notes === 'string' && raw.notes.trim()
    ? raw.notes.trim()
    : hotFiles.length > 0
      ? 'Hot files require proposal-first admission before live write.'
      : boundedRegions.length > 0
        ? 'Bounded-region proposal admission metadata supplied by task.'
        : '';
  const trigger = configuredTrigger
    ?? (hotFiles.length > 0 ? 'hot-file' : boundedRegions.length > 0 ? 'shared-surface-risk' : null);
  if (!trigger) {
    return undefined;
  }
  return {
    trigger,
    summarySubmitted: raw?.summarySubmitted === true,
    hotFiles: normalizeStringList([...(hotFiles ?? []), ...normalizeStringArray(raw?.hotFiles)]),
    boundedRegions,
    notes
  };
}

function deriveBoundedRegions(task: Record<string, unknown> | null): readonly ProposalAdmissionBoundedRegion[] {
  const rawRegions = normalizeRegionArray(
    asArray(task?.proposalAdmission && asRecord(task.proposalAdmission)?.boundedRegions)
    ?? asArray(task?.brokerProposalAdmission && asRecord(task.brokerProposalAdmission)?.boundedRegions)
    ?? asArray(task?.writeBoundedRegions)
    ?? asArray(task?.boundedRegions)
    ?? []
  );
  return rawRegions;
}

function normalizeRegionArray(value: readonly unknown[]): readonly ProposalAdmissionBoundedRegion[] {
  const regions: ProposalAdmissionBoundedRegion[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const filePath = typeof record?.filePath === 'string' ? record.filePath.replace(/\\/g, '/').trim() : '';
    const lineStart = normalizePositiveInteger(record?.lineStart);
    const lineEnd = normalizePositiveInteger(record?.lineEnd);
    if (!filePath || lineStart === null || lineEnd === null || lineEnd < lineStart) {
      continue;
    }
    regions.push({ filePath, lineStart, lineEnd });
  }
  return normalizeBoundedRegionList(regions);
}

function normalizeBoundedRegionList(regions: readonly ProposalAdmissionBoundedRegion[]): readonly ProposalAdmissionBoundedRegion[] {
  const seen = new Set<string>();
  const output: ProposalAdmissionBoundedRegion[] = [];
  for (const region of regions) {
    const key = `${region.filePath}:${region.lineStart}:${region.lineEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(region);
  }
  return output.sort((left, right) =>
    `${left.filePath}:${left.lineStart}:${left.lineEnd}`.localeCompare(`${right.filePath}:${right.lineStart}:${right.lineEnd}`)
  );
}

function normalizeProposalTrigger(value: unknown): ProposalAdmissionRequest['trigger'] | null {
  const trigger = typeof value === 'string' ? value.trim() : '';
  if (
    trigger === 'hot-file'
    || trigger === 'same-file-overlap-risk'
    || trigger === 'shared-surface-risk'
    || trigger === 'manual-review-surface'
  ) {
    return trigger;
  }
  return null;
}

function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
    : [];
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}
