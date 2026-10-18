// Receipt classification, deadlines, and retry accounting.
import { composeBrokerProposals } from './compose.ts';
import type { PatchProposal } from './types.ts';
import {
  SHARED_COMPOSE_CONTRACT,
  appendProposalStage,
  setKey,
  type ProposalStage,
  type ProposalTerminal,
  type StopReason,
  type SubmitSharedComposeInput
} from './shared-compose-inbox-contract.ts';
import {
  type ComposeBatchRecord,
  type SharedComposeReceipt,
  type StoredComposeProposal,
  deleteWindow,
  readProposal,
  readWindow,
  writeProposal,
  writeReceipt,
  writeWindow,
  withComposeFileLock
} from './shared-compose-inbox-fs.ts';

const LOCK_WAIT_MS = SHARED_COMPOSE_CONTRACT.lockWaitMs;
const MAX_RETRIES = SHARED_COMPOSE_CONTRACT.maxRetriesAfterFirstSubmit;

export function settleTerminal(args: {
  readonly renameAt: number | null;
  readonly ackAt: number | null;
  readonly effectiveStop: number;
  readonly intended: ProposalTerminal;
  readonly intendedReason: StopReason;
  readonly resultHash: string | null;
  readonly observedHash: string | null;
}): { readonly terminal: ProposalTerminal; readonly stopReason: StopReason } {
  if (args.resultHash && args.observedHash && args.resultHash !== args.observedHash) {
    return { terminal: 'inconsistent', stopReason: 'hash-mismatch' };
  }
  const noRenameTerminal = args.intended === 'rejected-conflict'
    || args.intended === 'rejected-admission'
    || args.intended === 'error'
    || args.intended === 'retry-exhausted'
    || args.intended === 'timeout';
  if (noRenameTerminal && args.renameAt === null) return { terminal: args.intended, stopReason: args.intendedReason };
  if (args.renameAt === null) return { terminal: 'timeout', stopReason: args.intendedReason };
  if (args.renameAt > args.effectiveStop) return { terminal: 'late-commit-after-timeout', stopReason: 'rename-after-stop' };
  if (args.ackAt === null) return { terminal: 'durable-unacked', stopReason: 'ack-missing' };
  if (args.ackAt > args.effectiveStop) return { terminal: 'durable-unacked', stopReason: 'ack-late' };
  if (args.intended === 'committed') return { terminal: 'committed', stopReason: 'acked-in-window' };
  return { terminal: args.intended, stopReason: args.intendedReason };
}

export function receiptFrom(
  proposal: StoredComposeProposal,
  batch: ComposeBatchRecord,
  fields: {
    readonly stage: ProposalStage;
    readonly stagesReached: ProposalStage[];
    readonly terminal: ProposalTerminal;
    readonly resolvedTerminal: ProposalTerminal | null;
    readonly resolvedStopReason: StopReason | null;
    readonly stopReason: StopReason;
    readonly detail: string | null;
    readonly ackAt: number | null;
    readonly elapsedMs: number;
    readonly renamed: boolean;
    readonly now: () => number;
  }
): SharedComposeReceipt {
  const accepted = batch.terminal === 'timeout' ? [] : batch.acceptedIds;
  return {
    schemaId: SHARED_COMPOSE_CONTRACT.schemaId,
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    actorId: proposal.actorId,
    scope: proposal.scope,
    ticket: proposal.ticket,
    validators: proposal.validators,
    stage: fields.stage,
    stagesReached: fields.stagesReached,
    batchId: batch.batchId,
    batchSize: batch.batchSize,
    memberProposalIds: batch.arrivals.map((arrival) => arrival.proposalId),
    acceptedSetKey: setKey(accepted),
    baseHash: batch.baseHash,
    declaredBaseHash: proposal.baseHash,
    resultHash: batch.resultHash,
    late: proposal.late,
    terminal: fields.terminal,
    resolvedTerminal: fields.resolvedTerminal,
    resolvedStopReason: fields.resolvedStopReason,
    stopReason: fields.stopReason,
    executableSeconds: executableSeconds(proposal),
    firstSubmittedAt: proposal.firstSubmittedAt,
    effectiveStopAt: effectiveStopAt(proposal),
    elapsedMs: fields.elapsedMs,
    attemptCount: proposal.attemptCount,
    retryCount: proposal.retryCount,
    renameAt: fields.renamed ? batch.renameAt : null,
    ackAt: fields.ackAt,
    renameCount: fields.renamed ? batch.renameCount : 0,
    detail: fields.detail,
    composeVerdict: batch.composeVerdict,
    diagnosticComposeVerdict: batch.diagnosticComposeVerdict,
    hashDriftCount: proposal.hashDriftCount,
    policyVersion: batch.policyVersion
  };
}

export function ensureProposal(input: SubmitSharedComposeInput, nowMs: number): StoredComposeProposal {
  const existing = readProposal(input.inboxDir, input.proposalId);
  if (existing) return existing;
  const admission = {
    admitted: input.admission?.admitted ?? true,
    reasonCode: input.admission?.reasonCode ?? null,
    waitMs: input.admission?.waitMs ?? 0
  };
  const stored: StoredComposeProposal = {
    proposalId: input.proposalId,
    taskId: input.taskId,
    actorId: input.actorId,
    targetFile: input.targetFile,
    targetPath: input.targetPath,
    baseHash: input.baseHash,
    baseBytes: input.baseBytes,
    baseCommit: input.baseCommit ?? null,
    patch: input.patch,
    scope: input.scope ?? null,
    ticket: input.ticket ?? null,
    validators: [...(input.validators ?? [])],
    arrivedAt: nowMs,
    firstSubmittedAt: nowMs,
    deadlineMs: input.deadlineMs ?? SHARED_COMPOSE_CONTRACT.defaultDeadlineMs,
    itemStopAt: input.itemStopAt ?? null,
    retryCount: 0,
    attemptCount: 1,
    late: false,
    admission,
    stages: ['admission'],
    hashDriftCount: 0
  };
  writeProposal(input.inboxDir, stored);
  return stored;
}

export function rejectAdmission(input: SubmitSharedComposeInput, proposal: StoredComposeProposal): SharedComposeReceipt {
  const receipt: SharedComposeReceipt = {
    ...emptyReceipt(proposal, input.baseHash),
    stage: 'admission',
    stagesReached: ['admission'],
    terminal: 'rejected-admission',
    stopReason: 'not-admitted',
    detail: proposal.admission.reasonCode,
    elapsedMs: 0
  };
  return writeReceipt(input.inboxDir, receipt);
}

export function finishTimeout(input: SubmitSharedComposeInput, proposal: StoredComposeProposal, nowMs: number): SharedComposeReceipt {
  withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => {
    const window = readWindow(input.inboxDir, input.targetFile);
    if (!window) return;
    window.members = window.members.filter((member) => member.proposalId !== proposal.proposalId);
    if (window.members.length === 0) deleteWindow(input.inboxDir, input.targetFile);
    else writeWindow(input.inboxDir, window);
  });
  const reason: StopReason = deadlineReason(proposal, nowMs);
  return writeReceipt(input.inboxDir, {
    ...emptyReceipt(proposal, proposal.baseHash),
    stage: proposal.stages[proposal.stages.length - 1] ?? 'admission',
    stagesReached: proposal.stages,
    terminal: 'timeout',
    stopReason: reason,
    detail: reason,
    elapsedMs: Math.max(0, nowMs - proposal.firstSubmittedAt)
  });
}

export function retryExhausted(input: SubmitSharedComposeInput, nowMs: number): SharedComposeReceipt {
  const proposal = mustProposal(input);
  return writeReceipt(input.inboxDir, {
    ...emptyReceipt(proposal, proposal.baseHash),
    stage: 'commit',
    stagesReached: appendProposalStage(proposal.stages, 'commit'),
    terminal: 'retry-exhausted',
    stopReason: 'retry-limit',
    detail: 'retry-limit',
    elapsedMs: Math.max(0, nowMs - proposal.firstSubmittedAt)
  });
}

export function consumeRetry(input: SubmitSharedComposeInput, nowMs: number): boolean {
  const proposal = mustProposal(input);
  if (nowMs >= effectiveStopAt(proposal)) return false;
  if (proposal.retryCount >= MAX_RETRIES) return false;
  proposal.retryCount += 1;
  proposal.attemptCount = proposal.retryCount + 1;
  writeProposal(input.inboxDir, proposal);
  return true;
}

export function finishError(input: SubmitSharedComposeInput, error: unknown, nowMs: number): SharedComposeReceipt {
  const proposal = readProposal(input.inboxDir, input.proposalId);
  const detail = error instanceof Error ? error.message : String(error);
  const stages = proposal?.stages ?? ['admission'];
  return writeReceipt(input.inboxDir, {
    ...emptyReceipt(proposal, input.baseHash, input),
    stage: stages[stages.length - 1] ?? 'admission',
    stagesReached: stages,
    terminal: 'error',
    stopReason: 'error',
    detail,
    elapsedMs: proposal ? Math.max(0, nowMs - proposal.firstSubmittedAt) : 0
  });
}

function emptyReceipt(
  proposal: StoredComposeProposal | null,
  declaredBaseHash: string,
  input?: SubmitSharedComposeInput
): SharedComposeReceipt {
  const first = proposal?.firstSubmittedAt ?? input?.now?.() ?? Date.now();
  const deadlineMs = proposal?.deadlineMs ?? input?.deadlineMs ?? SHARED_COMPOSE_CONTRACT.defaultDeadlineMs;
  const itemStopAt = proposal?.itemStopAt ?? input?.itemStopAt ?? null;
  const own = first + deadlineMs;
  const effectiveStop = itemStopAt === null ? own : Math.min(own, itemStopAt);
  return {
    schemaId: SHARED_COMPOSE_CONTRACT.schemaId,
    proposalId: proposal?.proposalId ?? input?.proposalId ?? '',
    taskId: proposal?.taskId ?? input?.taskId ?? '',
    actorId: proposal?.actorId ?? input?.actorId ?? '',
    scope: proposal?.scope ?? input?.scope ?? null,
    ticket: proposal?.ticket ?? input?.ticket ?? null,
    validators: proposal?.validators ?? [...(input?.validators ?? [])],
    stage: 'admission',
    stagesReached: proposal?.stages ?? ['admission'],
    batchId: null,
    batchSize: null,
    memberProposalIds: [],
    acceptedSetKey: [],
    baseHash: declaredBaseHash,
    declaredBaseHash,
    resultHash: null,
    late: proposal?.late ?? false,
    terminal: 'error',
    resolvedTerminal: null,
    resolvedStopReason: null,
    stopReason: 'error',
    executableSeconds: Math.max(0, effectiveStop - first) / 1000,
    firstSubmittedAt: first,
    effectiveStopAt: effectiveStop,
    elapsedMs: 0,
    attemptCount: proposal?.attemptCount ?? 1,
    retryCount: proposal?.retryCount ?? 0,
    renameAt: null,
    ackAt: null,
    renameCount: 0,
    detail: null,
    composeVerdict: null,
    diagnosticComposeVerdict: null,
    hashDriftCount: proposal?.hashDriftCount ?? 0,
    policyVersion: SHARED_COMPOSE_CONTRACT.policyVersion
  };
}

export function effectiveStopAt(proposal: StoredComposeProposal): number {
  const own = proposal.firstSubmittedAt + proposal.deadlineMs;
  if (proposal.itemStopAt === null) return own;
  return Math.min(own, proposal.itemStopAt);
}

function executableSeconds(proposal: StoredComposeProposal): number {
  return Math.max(0, effectiveStopAt(proposal) - proposal.firstSubmittedAt) / 1000;
}

export function proposalClockStopReason(proposal: StoredComposeProposal, nowMs: number): StopReason {
  return deadlineReason(proposal, nowMs);
}

function deadlineReason(proposal: StoredComposeProposal, nowMs: number): StopReason {
  const own = proposal.firstSubmittedAt + proposal.deadlineMs;
  if (proposal.itemStopAt !== null && proposal.itemStopAt <= own && nowMs >= proposal.itemStopAt) return 'item-stop';
  return 'own-deadline';
}

export function diagnosticVerdict(members: readonly StoredComposeProposal[]): string | null {
  try {
    return composeBrokerProposals(members.map(toPatchProposal)).mergePlan.verdict;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function toPatchProposal(proposal: StoredComposeProposal): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'shared-compose-inbox' },
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    actorId: proposal.actorId,
    baseCommit: proposal.baseCommit ?? '0'.repeat(40),
    fileBeforeHash: proposal.baseHash,
    targetFile: proposal.targetFile,
    atomRefs: [{ atomId: `atom.${proposal.proposalId}`, atomCid: `cid.${proposal.proposalId}` }],
    anchors: [{ kind: 'batch', hint: proposal.proposalId }],
    intent: proposal.proposalId,
    patch: proposal.patch,
    validators: proposal.validators,
    rollback: 'discard'
  };
}

export function mustProposal(input: SubmitSharedComposeInput): StoredComposeProposal {
  const proposal = readProposal(input.inboxDir, input.proposalId);
  if (!proposal) throw new Error(`找不到提案 ${input.proposalId}`);
  return proposal;
}

