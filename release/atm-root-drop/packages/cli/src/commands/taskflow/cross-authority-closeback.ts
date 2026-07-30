import { createHash } from 'node:crypto';

export type CrossAuthorityClosebackPhase =
  | 'prepared'
  | 'target-committed'
  | 'planning-committed'
  | 'both-committed'
  | 'closeback-pending';

export type CrossAuthorityClosebackAuthorityName = 'target' | 'planning';
export type CrossAuthorityClosebackRecoveryDisposition = 'execute-now' | 'queue' | 'recover' | 'wait' | 'human-required';
export type CrossAuthorityClosebackRecoveryOwner =
  | CrossAuthorityClosebackAuthorityName
  | 'runner-sync'
  | 'pre-push'
  | 'evidence'
  | 'close'
  | 'human'
  | 'global';

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

export interface CrossAuthorityClosebackRecoveryLane {
  readonly disposition: CrossAuthorityClosebackRecoveryDisposition;
  readonly owner: CrossAuthorityClosebackRecoveryOwner;
  readonly command: string | null;
  readonly reason: string;
  readonly forbiddenActions: readonly string[];
  readonly emergency: boolean;
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

export interface CrossAuthorityClosebackRecoveryObservation {
  readonly owner: 'runner-sync' | 'pre-push' | 'evidence' | 'close';
  readonly blockedBy: readonly ('runner-sync' | 'pre-push' | 'evidence' | 'close')[];
  readonly summary?: string | null;
}

export interface CrossAuthorityClosebackRecoveryCycle {
  readonly nodes: readonly CrossAuthorityClosebackRecoveryObservation['owner'][];
  readonly summary: string;
  readonly nextLegalRecoveryLane: CrossAuthorityClosebackRecoveryLane;
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
    readonly owner: CrossAuthorityClosebackRecoveryOwner;
    readonly recoveryLane: CrossAuthorityClosebackRecoveryLane;
    readonly forbiddenActions: readonly string[];
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
  readonly legalRecoveryLanes: readonly CrossAuthorityClosebackRecoveryLane[];
  readonly nextLegalRecoveryLane: CrossAuthorityClosebackRecoveryLane;
  readonly forbiddenActions: readonly string[];
  readonly recoveryCycles: readonly CrossAuthorityClosebackRecoveryCycle[];
  readonly emergencyLanes: readonly CrossAuthorityClosebackRecoveryLane[];
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
  readonly recoveryObservations?: readonly CrossAuthorityClosebackRecoveryObservation[];
}

export interface CrossAuthorityClosebackPorts {
  readonly recoveryCommandFor?: (input: {
    readonly taskId: string;
    readonly authority: CrossAuthorityClosebackRecoveryOwner;
    readonly phase: CrossAuthorityClosebackPhase;
    readonly disposition?: CrossAuthorityClosebackRecoveryDisposition;
  }) => string | null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  authority: CrossAuthorityClosebackRecoveryOwner,
  phase: CrossAuthorityClosebackPhase,
  disposition?: CrossAuthorityClosebackRecoveryDisposition
): string | null {
  return ports.recoveryCommandFor?.({ taskId, authority, phase, disposition }) ?? defaultRecoveryCommand(taskId);
}

function defaultForbiddenActions(owner: CrossAuthorityClosebackRecoveryOwner): string[] {
  return [
    `Do not bypass the ${owner} gate with raw git commands.`,
    'Do not use --force, --no-verify, or manual .atm edits unless an explicit emergency lane says so.',
    'Do not mutate another authority while this blocker owns the recovery lane.'
  ];
}

function recoveryLane(input: {
  readonly taskId: string;
  readonly owner: CrossAuthorityClosebackRecoveryOwner;
  readonly phase: CrossAuthorityClosebackPhase;
  readonly disposition: CrossAuthorityClosebackRecoveryDisposition;
  readonly reason: string;
  readonly ports: CrossAuthorityClosebackPorts;
  readonly emergency?: boolean;
  readonly command?: string | null;
}): CrossAuthorityClosebackRecoveryLane {
  const command = input.command === undefined
    ? recoveryCommand(input.ports, input.taskId, input.owner, input.phase, input.disposition)
    : input.command;
  return {
    disposition: input.disposition,
    owner: input.owner,
    command,
    reason: input.reason,
    forbiddenActions: defaultForbiddenActions(input.owner),
    emergency: input.emergency === true
  };
}

function addBlocker(
  blockers: CrossAuthorityClosebackBlocker[],
  input: {
    readonly code: string;
    readonly summary: string;
    readonly lane: CrossAuthorityClosebackRecoveryLane;
  }
): void {
  blockers.push({
    code: input.code,
    summary: input.summary,
    owner: input.lane.owner,
    recoveryLane: input.lane,
    forbiddenActions: input.lane.forbiddenActions,
    recoveryCommand: input.lane.command ?? ''
  });
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
  if (input.targetCommit && input.planningCommit) return 'closeback-pending';
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
    recoveryCommand: recoveryCommand(input.ports, input.taskId, input.authority, input.phase) ?? defaultRecoveryCommand(input.taskId)
  };
}

function uniqueRecoveryLanes(lanes: readonly CrossAuthorityClosebackRecoveryLane[]): CrossAuthorityClosebackRecoveryLane[] {
  const seen = new Set<string>();
  const result: CrossAuthorityClosebackRecoveryLane[] = [];
  for (const lane of lanes) {
    const key = `${lane.owner}:${lane.disposition}:${lane.command ?? '<none>'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lane);
  }
  return result;
}

function detectRecoveryCycles(input: {
  readonly taskId: string;
  readonly phase: CrossAuthorityClosebackPhase;
  readonly observations: readonly CrossAuthorityClosebackRecoveryObservation[];
  readonly ports: CrossAuthorityClosebackPorts;
}): CrossAuthorityClosebackRecoveryCycle[] {
  const graph = new Map<CrossAuthorityClosebackRecoveryObservation['owner'], Set<CrossAuthorityClosebackRecoveryObservation['owner']>>();
  for (const observation of input.observations) {
    graph.set(observation.owner, new Set(observation.blockedBy));
  }
  for (const [owner] of graph) {
    const stack: CrossAuthorityClosebackRecoveryObservation['owner'][] = [];
    const seen = new Set<CrossAuthorityClosebackRecoveryObservation['owner']>();
    const visit = (node: CrossAuthorityClosebackRecoveryObservation['owner']): CrossAuthorityClosebackRecoveryCycle | null => {
      if (stack.includes(node)) {
        const nodes = stack.slice(stack.indexOf(node));
        return {
          nodes,
          summary: `Recovery cycle detected among ${nodes.join(' -> ')}.`,
          nextLegalRecoveryLane: recoveryLane({
            taskId: input.taskId,
            owner: 'runner-sync',
            phase: input.phase,
            disposition: 'recover',
            reason: 'Break close recovery cycles by making the frozen runner match source before pre-push, evidence, or close retries.',
            ports: input.ports
          })
        };
      }
      if (seen.has(node)) return null;
      seen.add(node);
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
      stack.pop();
      return null;
    };
    const cycle = visit(owner);
    if (cycle) return [cycle];
  }
  return [];
}

function closeReadyLane(taskId: string, phase: CrossAuthorityClosebackPhase, ports: CrossAuthorityClosebackPorts): CrossAuthorityClosebackRecoveryLane {
  return recoveryLane({
    taskId,
    owner: 'global',
    phase,
    disposition: 'execute-now',
    reason: 'All closeback authorities are ready; execute the next idempotent saga step.',
    ports
  });
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
  const recoveryLanes: CrossAuthorityClosebackRecoveryLane[] = [];

  if (!snapshot.target.writeable) {
    const lane = recoveryLane({
      taskId: request.taskId,
      owner: 'target',
      phase,
      disposition: 'human-required',
      reason: 'Target authority is not writeable; an operator must restore or choose the authority before close can proceed.',
      ports,
      command: null
    });
    recoveryLanes.push(lane);
    addBlocker(blockers, {
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Target authority is not writeable at prepare time.',
      lane
    });
  }
  if (!snapshot.planning.writeable) {
    const lane = recoveryLane({
      taskId: request.taskId,
      owner: 'planning',
      phase,
      disposition: 'human-required',
      reason: 'Planning authority is not writeable; an operator must restore or choose the authority before close can proceed.',
      ports,
      command: null
    });
    recoveryLanes.push(lane);
    addBlocker(blockers, {
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Planning authority is not writeable at prepare time.',
      lane
    });
  }
  if (snapshot.target.remoteVisibilityRequired === true && targetCommit && !targetRemoteVisible) {
    const lane = recoveryLane({
      taskId: request.taskId,
      owner: 'target',
      phase,
      disposition: 'wait',
      reason: 'Target authority commit exists locally; wait for canonical remote visibility before replaying closeback.',
      ports
    });
    recoveryLanes.push(lane);
    addBlocker(blockers, {
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Target authority commit is local-durable but not remote-visible on the canonical ref.',
      lane
    });
  }
  if (snapshot.planning.remoteVisibilityRequired === true && planningCommit && !planningRemoteVisible) {
    const lane = recoveryLane({
      taskId: request.taskId,
      owner: 'planning',
      phase,
      disposition: 'wait',
      reason: 'Planning authority commit exists locally; wait for canonical remote visibility before replaying closeback.',
      ports
    });
    recoveryLanes.push(lane);
    addBlocker(blockers, {
      code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
      summary: 'Planning authority commit is local-durable but not remote-visible on the canonical ref.',
      lane
    });
  }

  const effectivePhase: CrossAuthorityClosebackPhase = blockers.length > 0 && phase === 'both-committed' ? 'closeback-pending' : phase;
  const recoveryCycles = detectRecoveryCycles({
    taskId: request.taskId,
    phase: effectivePhase,
    observations: snapshot.recoveryObservations ?? [],
    ports
  });
  for (const cycle of recoveryCycles) {
    recoveryLanes.push(cycle.nextLegalRecoveryLane);
    addBlocker(blockers, {
      code: 'ATM_TASKFLOW_CLOSE_RECOVERY_CYCLE',
      summary: cycle.summary,
      lane: cycle.nextLegalRecoveryLane
    });
  }

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
  const legalRecoveryLanes = uniqueRecoveryLanes([
    ...recoveryLanes,
    ...(blockers.length === 0 ? [closeReadyLane(request.taskId, effectivePhase, ports)] : [])
  ]);
  const nextLegalRecoveryLane = blockers[0]?.recoveryLane ?? legalRecoveryLanes[0] ?? closeReadyLane(request.taskId, effectivePhase, ports);
  const forbiddenActions = uniqueStrings(legalRecoveryLanes.flatMap((lane) => lane.forbiddenActions));
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
    recoveryCommand: nextLegalRecoveryLane.command ?? defaultRecoveryCommand(request.taskId),
    legalRecoveryLanes,
    nextLegalRecoveryLane,
    forbiddenActions,
    recoveryCycles,
    emergencyLanes: legalRecoveryLanes.filter((lane) => lane.emergency)
  };
}
