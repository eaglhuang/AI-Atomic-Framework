import type { TeamWaveEnvelope } from './team-wave-envelope.ts';

export type WaveManifestState =
  | 'planned'
  | 'admitted'
  | 'executing'
  | 'ready-for-write'
  | 'writing'
  | 'ready-to-close'
  | 'closed'
  | 'needs-review'
  | 'failed-retryable'
  | 'failed-terminal';

export interface WaveManifestTask {
  readonly taskId: string;
  readonly waveId: string;
  readonly targetRepo: string;
  readonly surfaceFamily: string;
  readonly scopePaths: readonly string[];
  readonly validators: readonly string[];
  readonly dependencyReady: boolean;
  readonly laneSessionId?: string | null;
  readonly claimId?: string | null;
}

export interface WaveManifestTicket {
  readonly ticketId: string;
  readonly taskId: string;
  readonly surfaceFamily: string;
  readonly state: string;
}

export interface WaveManifestReceipt {
  readonly receiptId: string;
  readonly kind: 'commit' | 'build' | 'projection' | 'checkpoint' | 'worker';
  readonly taskIds: readonly string[];
  readonly digest?: string | null;
}

export interface WaveManifest {
  readonly schemaId: 'atm.waveManifest.v1';
  readonly specVersion: '0.1.0';
  readonly waveId: string;
  readonly batchRunId: string;
  readonly state: WaveManifestState;
  readonly sealedBaseSha: string | null;
  readonly coordinatorActorId: string;
  readonly executor: 'auto' | 'local-lanes' | 'editor-subagents' | 'team-agents' | 'manual';
  readonly targetRepo: string;
  readonly tasks: readonly WaveManifestTask[];
  readonly brokerTickets: readonly WaveManifestTicket[];
  readonly sharedReceipts: readonly WaveManifestReceipt[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WaveManifestValidation {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export interface WaveEligibilityDecision {
  readonly ok: boolean;
  readonly waveId: string | null;
  readonly surfaceFamily: string | null;
  readonly taskIds: readonly string[];
  readonly reasons: readonly string[];
}

const terminalStates = new Set<WaveManifestState>(['closed', 'failed-terminal']);
const transitionMap: Readonly<Record<WaveManifestState, readonly WaveManifestState[]>> = {
  planned: ['admitted', 'needs-review', 'failed-terminal'],
  admitted: ['executing', 'needs-review', 'failed-retryable', 'failed-terminal'],
  executing: ['ready-for-write', 'needs-review', 'failed-retryable', 'failed-terminal'],
  'ready-for-write': ['writing', 'needs-review', 'failed-retryable', 'failed-terminal'],
  writing: ['ready-to-close', 'needs-review', 'failed-retryable', 'failed-terminal'],
  'ready-to-close': ['closed', 'needs-review', 'failed-retryable', 'failed-terminal'],
  closed: [],
  'needs-review': ['planned', 'admitted', 'executing', 'failed-terminal'],
  'failed-retryable': ['planned', 'admitted', 'executing', 'failed-terminal'],
  'failed-terminal': []
};

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function createWaveManifest(input: {
  readonly waveId: string;
  readonly batchRunId: string;
  readonly coordinatorActorId: string;
  readonly targetRepo: string;
  readonly tasks: readonly WaveManifestTask[];
  readonly executor?: WaveManifest['executor'];
  readonly sealedBaseSha?: string | null;
  readonly state?: WaveManifestState;
  readonly brokerTickets?: readonly WaveManifestTicket[];
  readonly sharedReceipts?: readonly WaveManifestReceipt[];
  readonly now?: string;
}): WaveManifest {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaId: 'atm.waveManifest.v1',
    specVersion: '0.1.0',
    waveId: input.waveId,
    batchRunId: input.batchRunId,
    state: input.state ?? 'planned',
    sealedBaseSha: input.sealedBaseSha ?? null,
    coordinatorActorId: input.coordinatorActorId,
    executor: input.executor ?? 'manual',
    targetRepo: input.targetRepo,
    tasks: input.tasks,
    brokerTickets: input.brokerTickets ?? [],
    sharedReceipts: input.sharedReceipts ?? [],
    createdAt: now,
    updatedAt: now
  };
}

export function validateWaveManifest(manifest: WaveManifest): WaveManifestValidation {
  const reasons: string[] = [];
  if (manifest.schemaId !== 'atm.waveManifest.v1') reasons.push('schemaId must be atm.waveManifest.v1');
  if (!manifest.waveId.trim()) reasons.push('waveId is required');
  if (!manifest.batchRunId.trim()) reasons.push('batchRunId is required');
  if (!manifest.coordinatorActorId.trim()) reasons.push('coordinatorActorId is required');
  if (!manifest.targetRepo.trim()) reasons.push('targetRepo is required');
  if (manifest.tasks.length === 0) reasons.push('at least one task is required');

  const seenTaskIds = new Set<string>();
  for (const task of manifest.tasks) {
    if (!task.taskId.trim()) reasons.push('every task requires taskId');
    if (seenTaskIds.has(task.taskId)) reasons.push(`duplicate taskId ${task.taskId}`);
    seenTaskIds.add(task.taskId);
    if (task.targetRepo !== manifest.targetRepo) reasons.push(`task ${task.taskId} targetRepo differs`);
    if (!task.surfaceFamily.trim()) reasons.push(`task ${task.taskId} surfaceFamily is required`);
    if (task.scopePaths.length === 0) reasons.push(`task ${task.taskId} requires scopePaths`);
  }

  return { ok: reasons.length === 0, reasons };
}

export function canTransitionWaveManifest(from: WaveManifestState, to: WaveManifestState): boolean {
  if (from === to) return true;
  if (terminalStates.has(from)) return false;
  return transitionMap[from].includes(to);
}

export function transitionWaveManifest(manifest: WaveManifest, to: WaveManifestState, now = new Date().toISOString()): WaveManifest {
  if (!canTransitionWaveManifest(manifest.state, to)) {
    throw new Error(`invalid wave manifest transition ${manifest.state} -> ${to}`);
  }
  return { ...manifest, state: to, updatedAt: now };
}

export function evaluateWaveEligibility(tasks: readonly WaveManifestTask[]): WaveEligibilityDecision {
  const reasons: string[] = [];
  const waveId = tasks.length > 0 ? null : null;
  if (tasks.length === 0) return { ok: false, waveId: null, surfaceFamily: null, taskIds: [], reasons: ['at least one task is required'] };

  const repos = uniqueSorted(tasks.map((task) => task.targetRepo));
  const surfaces = uniqueSorted(tasks.map((task) => task.surfaceFamily));
  const missingDependencies = tasks.filter((task) => !task.dependencyReady).map((task) => task.taskId);
  const validatorless = tasks.filter((task) => task.validators.length === 0).map((task) => task.taskId);
  const inferredWaveIds = uniqueSorted(tasks.map((task) => task.waveId));

  if (repos.length !== 1) reasons.push('tasks must share one targetRepo');
  if (surfaces.length !== 1) reasons.push('tasks must share one surfaceFamily');
  if (missingDependencies.length > 0) reasons.push(`dependencies not ready: ${missingDependencies.join(',')}`);
  if (validatorless.length > 0) reasons.push(`validators missing: ${validatorless.join(',')}`);

  return {
    ok: reasons.length === 0,
    waveId: inferredWaveIds.length === 1 ? inferredWaveIds[0] : null,
    surfaceFamily: surfaces.length === 1 ? surfaces[0] : null,
    taskIds: uniqueSorted(tasks.map((task) => task.taskId)),
    reasons
  };
}

export function waveManifestSummary(manifest: WaveManifest) {
  return {
    schemaId: 'atm.waveManifestSummary.v1' as const,
    waveId: manifest.waveId,
    batchRunId: manifest.batchRunId,
    state: manifest.state,
    taskIds: uniqueSorted(manifest.tasks.map((task) => task.taskId)),
    surfaceFamilies: uniqueSorted(manifest.tasks.map((task) => task.surfaceFamily)),
    brokerTicketCount: manifest.brokerTickets.length,
    sharedReceiptCount: manifest.sharedReceipts.length
  };
}

export function fromTeamWaveEnvelope(envelope: TeamWaveEnvelope, input: {
  readonly batchRunId: string;
  readonly sealedBaseSha?: string | null;
  readonly validatorsByTask?: Readonly<Record<string, readonly string[]>>;
  readonly dependencyReadyByTask?: Readonly<Record<string, boolean>>;
  readonly surfaceFamilyByTask?: Readonly<Record<string, string>>;
  readonly now?: string;
}): WaveManifest {
  return createWaveManifest({
    waveId: envelope.waveId,
    batchRunId: input.batchRunId,
    coordinatorActorId: envelope.coordinatorActorId,
    targetRepo: envelope.targetRepo ?? 'unknown',
    sealedBaseSha: input.sealedBaseSha ?? null,
    executor: 'team-agents',
    now: input.now ?? envelope.metadata.plannedAt,
    tasks: envelope.members.map((member) => ({
      taskId: member.taskId,
      waveId: envelope.waveId,
      targetRepo: envelope.targetRepo ?? 'unknown',
      surfaceFamily: input.surfaceFamilyByTask?.[member.taskId] ?? 'unknown',
      scopePaths: member.scopePaths,
      validators: input.validatorsByTask?.[member.taskId] ?? [],
      dependencyReady: input.dependencyReadyByTask?.[member.taskId] ?? true,
      claimId: member.patchEnvelopeId,
      laneSessionId: member.workerActorId
    }))
  });
}
