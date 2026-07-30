import { createHash } from 'node:crypto';

export type CrossAuthorityClosebackPhase =
  | 'prepared'
  | 'target-committed'
  | 'planning-committed'
  | 'both-committed'
  | 'closeback-pending';

export type CrossAuthorityClosebackAuthorityName = 'target' | 'planning';

export interface CrossAuthorityClosebackAuthoritySnapshot {
  readonly name: CrossAuthorityClosebackAuthorityName;
  readonly repoRoot: string;
  readonly head: string | null;
  readonly sourceDigest?: string | null;
  readonly writeable: boolean;
  readonly remoteVisibilityRequired?: boolean;
  readonly canonicalRemote?: string | null;
  readonly canonicalRef?: string | null;
  readonly remoteReachableCommit?: string | null;
}

export interface CrossAuthorityClosebackStep {
  readonly id: string;
  readonly authority: CrossAuthorityClosebackAuthorityName;
  readonly kind: 'prepare' | 'commit' | 'receipt' | 'remote-visibility' | 'finalize';
  readonly idempotencyKey: string;
  readonly recoveryCommand: string;
}

export interface CrossAuthorityClosebackSideEffect {
  readonly id: string;
  readonly authority: CrossAuthorityClosebackAuthorityName;
  readonly kind: 'commit' | 'receipt' | 'notification' | 'broker-release' | 'planning-closeback';
  readonly idempotencyKey: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly commitSha?: string | null;
}

export interface CrossAuthorityClosebackReceipt {
  readonly schemaId: 'atm.crossAuthorityClosebackReceipt.v1';
  readonly taskId: string;
  readonly sourceIdentity: string;
  readonly target: CrossAuthorityClosebackAuthoritySnapshot;
  readonly planning: CrossAuthorityClosebackAuthoritySnapshot;
  readonly targetBundleDigest: string;
  readonly planningPatchDigest: string;
  readonly planStatusTransition: string | null;
  readonly acceptanceEvidenceDigest: string | null;
  readonly phase: CrossAuthorityClosebackPhase;
  readonly sideEffectJournal: readonly CrossAuthorityClosebackSideEffect[];
  readonly receiptDigest: string;
}

export interface CrossAuthorityClosebackPlan {
  readonly schemaId: 'atm.crossAuthorityClosebackPlan.v1';
  readonly taskId: string;
  readonly sourceIdentity: string;
  readonly phase: CrossAuthorityClosebackPhase;
  readonly globalCompletion: 'complete' | 'closeback-pending';
  readonly blockers: readonly {
    readonly code: string;
    readonly summary: string;
    readonly recoveryCommand: string;
  }[];
  readonly expectedFiles: {
    readonly target: readonly string[];
    readonly planning: readonly string[];
  };
  readonly authorityCas: {
    readonly targetHead: string | null;
    readonly planningHead: string | null;
    readonly targetSourceDigest: string | null;
    readonly planningSourceDigest: string | null;
  };
  readonly steps: readonly CrossAuthorityClosebackStep[];
  readonly compensations: readonly string[];
  readonly receipt: CrossAuthorityClosebackReceipt;
  readonly recoveryCommand: string;
}

type CrossAuthorityClosebackBlocker = CrossAuthorityClosebackPlan['blockers'][number];

export interface CrossAuthorityClosebackRequest {
  readonly taskId: string;
  readonly actorId: string;
  readonly sourceIdentity: string;
  readonly targetFiles: readonly string[];
  readonly planningFiles: readonly string[];
  readonly targetBundleDigest: string;
  readonly planningPatchDigest: string;
  readonly planStatusTransition?: string | null;
  readonly acceptanceEvidenceDigest?: string | null;
}

export interface CrossAuthorityClosebackSnapshot {
  readonly target: CrossAuthorityClosebackAuthoritySnapshot;
  readonly planning: CrossAuthorityClosebackAuthoritySnapshot;
  readonly completedSideEffects?: readonly CrossAuthorityClosebackSideEffect[];
}

export interface CrossAuthorityClosebackPorts {
  readonly recoveryCommandFor?: (input: {
    readonly taskId: string;
    readonly authority: CrossAuthorityClosebackAuthorityName | 'global';
    readonly phase: CrossAuthorityClosebackPhase;
  }) => string;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex')}`;
}

function idempotencyKey(input: {
  readonly taskId: string;
  readonly authority: CrossAuthorityClosebackAuthorityName;
  readonly kind: string;
  readonly head: string | null;
  readonly digest: string | null;
}): string {
  return [
    'atm-cross-authority-closeback',
    input.taskId.trim().toUpperCase(),
    input.authority,
    input.kind,
    input.head ?? 'no-head',
    input.digest ?? 'no-digest'
  ].join(':');
}

function defaultRecoveryCommand(taskId: string): string {
  return `node atm.mjs taskflow diagnose --task ${taskId} --json`;
}

function recoveryCommand(
  ports: CrossAuthorityClosebackPorts,
  taskId: string,
  authority: CrossAuthorityClosebackAuthorityName | 'global',
  phase: CrossAuthorityClosebackPhase
): string {
  return ports.recoveryCommandFor?.({ taskId, authority, phase }) ?? defaultRecoveryCommand(taskId);
}

function completedCommitFor(
  sideEffects: readonly CrossAuthorityClosebackSideEffect[],
  authority: CrossAuthorityClosebackAuthorityName
): string | null {
  return sideEffects.find((effect) => effect.authority === authority && effect.kind === 'commit' && effect.status === 'completed')?.commitSha ?? null;
}

function authorityRemoteVisible(authority: CrossAuthorityClosebackAuthoritySnapshot, commitSha: string | null): boolean {
  if (authority.remoteVisibilityRequired !== true) return true;
  return Boolean(commitSha && authority.remoteReachableCommit === commitSha);
}

function derivePhase(input: {
  readonly targetCommit: string | null;
  readonly planningCommit: string | null;
  readonly targetRemoteVisible: boolean;
  readonly planningRemoteVisible: boolean;
}): CrossAuthorityClosebackPhase {
  if (input.targetCommit && input.planningCommit && input.targetRemoteVisible && input.planningRemoteVisible) {
    return 'both-committed';
  }
  if (input.targetCommit && input.planningCommit) {
    return 'closeback-pending';
  }
  if (input.targetCommit) return 'target-committed';
  if (input.planningCommit) return 'planning-committed';
  return 'prepared';
}

function buildStep(input: {
  readonly taskId: string;
  readonly authority: CrossAuthorityClosebackAuthorityName;
  readonly kind: CrossAuthorityClosebackStep['kind'];
  readonly head: string | null;
  readonly digest: string | null;
  readonly phase: CrossAuthorityClosebackPhase;
  readonly ports: CrossAuthorityClosebackPorts;
}): CrossAuthorityClosebackStep {
  const id = `${input.authority}:${input.kind}`;
  return {
    id,
    authority: input.authority,
    kind: input.kind,
    idempotencyKey: idempotencyKey(input),
    recoveryCommand: recoveryCommand(input.ports, input.taskId, input.authority, input.phase)
  };
}

export function executeTaskCloseSaga(
  request: CrossAuthorityClosebackRequest,
  snapshot: CrossAuthorityClosebackSnapshot,
  ports: CrossAuthorityClosebackPorts = {}
): CrossAuthorityClosebackPlan {
  const targetFiles = uniqueSorted(request.targetFiles);
  const planningFiles = uniqueSorted(request.planningFiles);
  const sideEffectJournal = [...(snapshot.completedSideEffects ?? [])];
  const targetCommit = completedCommitFor(sideEffectJournal, 'target');
  const planningCommit = completedCommitFor(sideEffectJournal, 'planning');
  const targetRemoteVisible = authorityRemoteVisible(snapshot.target, targetCommit);
  const planningRemoteVisible = authorityRemoteVisible(snapshot.planning, planningCommit);
  const phase = derivePhase({ targetCommit, planningCommit, targetRemoteVisible, planningRemoteVisible });
  const blockers: CrossAuthorityClosebackBlocker[] = [];

  if (!snapshot.target.writeable) {
    blockers.push({
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Target authority is not writeable at prepare time.',
      recoveryCommand: recoveryCommand(ports, request.taskId, 'target', phase)
    });
  }
  if (!snapshot.planning.writeable) {
    blockers.push({
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Planning authority is not writeable at prepare time.',
      recoveryCommand: recoveryCommand(ports, request.taskId, 'planning', phase)
    });
  }
  if (snapshot.target.remoteVisibilityRequired === true && targetCommit && !targetRemoteVisible) {
    blockers.push({
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Target authority commit is local-durable but not remote-visible on the canonical ref.',
      recoveryCommand: recoveryCommand(ports, request.taskId, 'target', phase)
    });
  }
  if (snapshot.planning.remoteVisibilityRequired === true && planningCommit && !planningRemoteVisible) {
    blockers.push({
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Planning authority commit is local-durable but not remote-visible on the canonical ref.',
      recoveryCommand: recoveryCommand(ports, request.taskId, 'planning', phase)
    });
  }

  const effectivePhase: CrossAuthorityClosebackPhase = blockers.length > 0 && phase === 'both-committed' ? 'closeback-pending' : phase;
  const steps = [
    buildStep({ taskId: request.taskId, authority: 'target', kind: 'prepare', head: snapshot.target.head, digest: snapshot.target.sourceDigest ?? null, phase: effectivePhase, ports }),
    buildStep({ taskId: request.taskId, authority: 'planning', kind: 'prepare', head: snapshot.planning.head, digest: snapshot.planning.sourceDigest ?? null, phase: effectivePhase, ports }),
    ...(targetCommit ? [] : [buildStep({ taskId: request.taskId, authority: 'target', kind: 'commit', head: snapshot.target.head, digest: request.targetBundleDigest, phase: effectivePhase, ports })]),
    ...(planningCommit ? [] : [buildStep({ taskId: request.taskId, authority: 'planning', kind: 'commit', head: snapshot.planning.head, digest: request.planningPatchDigest, phase: effectivePhase, ports })]),
    buildStep({ taskId: request.taskId, authority: 'target', kind: 'receipt', head: targetCommit ?? snapshot.target.head, digest: request.targetBundleDigest, phase: effectivePhase, ports }),
    buildStep({ taskId: request.taskId, authority: 'planning', kind: 'receipt', head: planningCommit ?? snapshot.planning.head, digest: request.planningPatchDigest, phase: effectivePhase, ports }),
    ...(snapshot.target.remoteVisibilityRequired === true ? [buildStep({ taskId: request.taskId, authority: 'target', kind: 'remote-visibility', head: targetCommit, digest: snapshot.target.canonicalRef ?? null, phase: effectivePhase, ports })] : []),
    ...(snapshot.planning.remoteVisibilityRequired === true ? [buildStep({ taskId: request.taskId, authority: 'planning', kind: 'remote-visibility', head: planningCommit, digest: snapshot.planning.canonicalRef ?? null, phase: effectivePhase, ports })] : [])
  ];
  const receiptWithoutDigest = {
    schemaId: 'atm.crossAuthorityClosebackReceipt.v1' as const,
    taskId: request.taskId,
    sourceIdentity: request.sourceIdentity,
    target: snapshot.target,
    planning: snapshot.planning,
    targetBundleDigest: request.targetBundleDigest,
    planningPatchDigest: request.planningPatchDigest,
    planStatusTransition: request.planStatusTransition ?? null,
    acceptanceEvidenceDigest: request.acceptanceEvidenceDigest ?? null,
    phase: effectivePhase,
    sideEffectJournal
  };
  const receipt = {
    ...receiptWithoutDigest,
    receiptDigest: sha256Json(receiptWithoutDigest)
  };
  const globalCompletion = effectivePhase === 'both-committed' && blockers.length === 0 ? 'complete' : 'closeback-pending';
  return {
    schemaId: 'atm.crossAuthorityClosebackPlan.v1',
    taskId: request.taskId,
    sourceIdentity: request.sourceIdentity,
    phase: effectivePhase,
    globalCompletion,
    blockers,
    expectedFiles: {
      target: targetFiles,
      planning: planningFiles
    },
    authorityCas: {
      targetHead: snapshot.target.head,
      planningHead: snapshot.planning.head,
      targetSourceDigest: snapshot.target.sourceDigest ?? null,
      planningSourceDigest: snapshot.planning.sourceDigest ?? null
    },
    steps,
    compensations: [
      'Do not replay completed side effects; resume from the sealed side-effect journal.',
      'If an authority CAS moved, return closeback-pending and re-prepare against the observed authority.',
      'If rollback is required, reconcile the existing saga before reverting code.'
    ],
    receipt,
    recoveryCommand: recoveryCommand(ports, request.taskId, 'global', effectivePhase)
  };
}
