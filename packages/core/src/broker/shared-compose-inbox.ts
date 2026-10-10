// 跨程序共用收件匣與批次協調器。
// 預設 composeWindowMs 為 0：一份提案立刻成批，與既有單提案路徑相容。
// 窗長大於 0 時，同一目標檔、同一檔案 base 上的多個程序會進同一批（batch size 可大於 1）。
// 候選內容在鎖外合成；短鎖只包住「重驗 base hash + 寫入」。
import { composeBrokerProposals } from './compose.ts';
import type { PatchProposal } from './types.ts';
import { composeMembersAgainstBase } from './shared-compose-inbox-merge.ts';
import {
  type ComposeBatchRecord,
  type ComposeWindowRecord,
  type ProposalStage,
  type SharedComposeReceipt,
  type StoredComposeProposal,
  assertSafeProposalId,
  atomicWriteText,
  commitTempFile,
  composeToken,
  deleteWindow,
  ensureComposeInbox,
  hashComposeBytes,
  listBatches,
  readBatch,
  readProposal,
  readReceipt,
  readTargetText,
  readWindow,
  removeComposeTempFiles,
  writeBatch,
  writeProposal,
  writeReceipt,
  writeWindow,
  withComposeFileLock
} from './shared-compose-inbox-fs.ts';
export type { ProposalStage, ProposalTerminal, SharedComposeReceipt } from './shared-compose-inbox-fs.ts';
export { hashComposeBytes } from './shared-compose-inbox-fs.ts';
export interface SharedComposeAdmissionInput {
  readonly admitted: boolean;
  readonly reasonCode?: string | null;
  readonly waitMs?: number;
}
export interface SubmitSharedComposeInput {
  readonly inboxDir: string;
  readonly targetPath: string;
  readonly targetFile: string;
  readonly proposalId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly baseHash: string;
  readonly baseBytes: string;
  readonly patch: string;
  readonly baseCommit?: string | null;
  /** 預設 0。0 表示收到就封批，維持單提案行為。 */
  readonly composeWindowMs?: number;
  /** 預設 32。達到上限會提前封批。 */
  readonly maxBatchSize?: number;
  /** 預設 30000。單一提案從送出到終態的期限。 */
  readonly deadlineMs?: number;
  readonly admission?: SharedComposeAdmissionInput;
  /** 合成中的批次超過這個毫秒數，其他程序可以接手。 */
  readonly composingStaleMs?: number;
  /** 重驗通過且暫存檔已寫入之後、rename 之前。測試用來模擬崩潰。 */
  readonly onBeforeCommit?: () => void;
}
export interface RecoverSharedComposeInput {
  readonly inboxDir: string;
  readonly force?: boolean;
  readonly composingStaleMs?: number;
}
export interface RecoverSharedComposeResult {
  readonly recoveredBatchIds: readonly string[];
  readonly removedTempFiles: readonly string[];
}
const DEFAULT_WINDOW_MS = 0;
const DEFAULT_MAX_BATCH = 32;
const DEFAULT_DEADLINE_MS = 30_000;
const DEFAULT_STALE_MS = 2_000;
const LOCK_WAIT_MS = 5_000;
const MAX_REQUEUE = 32;
type PumpStep =
  | { readonly kind: 'receipt'; readonly receipt: SharedComposeReceipt }
  | { readonly kind: 'compose'; readonly batch: ComposeBatchRecord }
  | { readonly kind: 'resume'; readonly batch: ComposeBatchRecord }
  | { readonly kind: 'wait' };
export async function submitSharedComposeProposal(input: SubmitSharedComposeInput): Promise<SharedComposeReceipt> {
  assertSafeProposalId(input.proposalId);
  ensureComposeInbox(input.inboxDir);
  const existing = readReceipt(input.inboxDir, input.proposalId);
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
    arrivedAt: Date.now(),
    late: false,
    admission,
    stages: ['admission'],
    hashDriftCount: 0
  };
  writeProposal(input.inboxDir, stored);
  if (!admission.admitted) {
    return writeReceipt(input.inboxDir, receiptFrom(stored, {
      stage: 'admission',
      stagesReached: ['admission'],
      batchId: null,
      batchSize: null,
      baseHash: input.baseHash,
      late: false,
      terminal: 'rejected-admission',
      detail: admission.reasonCode,
      composeVerdict: null,
      diagnosticComposeVerdict: null
    }));
  }
  const deadline = Date.now() + (input.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const windowMs = input.composeWindowMs ?? DEFAULT_WINDOW_MS;
  const maxBatch = input.maxBatchSize ?? DEFAULT_MAX_BATCH;
  const staleMs = input.composingStaleMs ?? DEFAULT_STALE_MS;
  let requeues = 0;
  while (Date.now() < deadline) {
    let step: PumpStep;
    try {
      step = withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => pump(input, windowMs, maxBatch, staleMs));
    } catch (error) {
      if (isLockTimeout(error) && Date.now() < deadline) {
        await delay(15);
        continue;
      }
      return finishError(input, error);
    }
    if (step.kind === 'receipt') return step.receipt;
    if (step.kind === 'wait') {
      const ready = readReceipt(input.inboxDir, input.proposalId);
      if (ready) return ready;
      await delay(15);
      continue;
    }
    if (step.kind === 'resume') {
      try {
        withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => resumeCommit(input.inboxDir, step.batch.batchId));
      } catch (error) {
        return finishError(input, error);
      }
      continue;
    }
    let outcome: ComposeOutcome;
    try {
      outcome = composeBatch(input.inboxDir, step.batch);
    } catch (error) {
      return finishError(input, error);
    }
    let committed: 'ok' | 'requeue';
    try {
      committed = withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => (
        commitComposed(input, step.batch.batchId, outcome)
      ));
    } catch (error) {
      return finishError(input, error);
    }
    if (committed === 'requeue') {
      requeues += 1;
      if (requeues > MAX_REQUEUE) {
        return writeReceipt(input.inboxDir, receiptFrom(mustProposal(input), {
          stage: 'commit',
          stagesReached: ['admission', 'batch', 'compose', 'commit'],
          batchId: step.batch.batchId,
          batchSize: step.batch.batchSize,
          baseHash: step.batch.baseHash,
          late: false,
          terminal: 'rejected-hash-drift',
          detail: 'requeue-limit',
          composeVerdict: null,
          diagnosticComposeVerdict: outcome.diagnostic
        }));
      }
      continue;
    }
    const receipt = readReceipt(input.inboxDir, input.proposalId);
    if (receipt) return receipt;
  }
  const lateReceipt = readReceipt(input.inboxDir, input.proposalId);
  if (lateReceipt) return lateReceipt;
  const proposal = mustProposal(input);
  return writeReceipt(input.inboxDir, receiptFrom(proposal, {
    stage: proposal.stages[proposal.stages.length - 1] ?? 'admission',
    stagesReached: proposal.stages,
    batchId: null,
    batchSize: null,
    baseHash: proposal.baseHash,
    late: proposal.late,
    terminal: 'timeout',
    detail: 'deadline',
    composeVerdict: null,
    diagnosticComposeVerdict: null
  }));
}
export function recoverSharedComposeInbox(input: RecoverSharedComposeInput): RecoverSharedComposeResult {
  if (!input.inboxDir) return { recoveredBatchIds: [], removedTempFiles: [] };
  ensureComposeInbox(input.inboxDir);
  const staleMs = input.composingStaleMs ?? DEFAULT_STALE_MS;
  const recovered: string[] = [];
  const tempDirs = new Set<string>([input.inboxDir]);
  for (const batch of listBatches(input.inboxDir)) {
    tempDirs.add(batch.targetPath ? dirnameOf(batch.targetPath) : input.inboxDir);
    if (batch.status !== 'composing' && batch.status !== 'committing') continue;
    if (batch.status === 'composing' && !input.force && Date.now() - batch.sealedAt < staleMs) continue;
    withComposeFileLock(input.inboxDir, batch.targetFile, LOCK_WAIT_MS, () => {
      const current = readBatch(input.inboxDir, batch.batchId);
      if (!current) return;
      if (current.status === 'committing') {
        resumeCommit(input.inboxDir, current.batchId);
        recovered.push(current.batchId);
        return;
      }
      if (current.status !== 'composing') return;
      const outcome = composeBatch(input.inboxDir, current);
      commitComposed({
        inboxDir: input.inboxDir,
        targetPath: current.targetPath,
        targetFile: current.targetFile,
        proposalId: current.arrivals[0]?.proposalId ?? 'recover',
        taskId: 'recover',
        actorId: 'recover',
        baseHash: current.baseHash,
        baseBytes: current.baseBytes,
        patch: ''
      }, current.batchId, outcome);
      recovered.push(current.batchId);
    });
  }
  const removedTempFiles = removeComposeTempFiles([...tempDirs]);
  return { recoveredBatchIds: recovered, removedTempFiles };
}
function pump(input: SubmitSharedComposeInput, windowMs: number, maxBatch: number, staleMs: number): PumpStep {
  const receipt = readReceipt(input.inboxDir, input.proposalId);
  if (receipt) return { kind: 'receipt', receipt };
  const active = findActiveBatch(input.inboxDir, input.proposalId);
  if (active) {
    if (active.status === 'committed' || active.status === 'rejected') {
      writeMemberReceipts(input.inboxDir, active);
      const written = readReceipt(input.inboxDir, input.proposalId);
      if (written) return { kind: 'receipt', receipt: written };
    }
    if (active.status === 'committing') return { kind: 'resume', batch: active };
    if (active.status === 'composing') {
      if (Date.now() - active.sealedAt >= staleMs) return { kind: 'compose', batch: active };
      return { kind: 'wait' };
    }
  }
  const fileBytes = readTargetText(input.targetPath);
  const fileHash = hashComposeBytes(fileBytes);
  const window = readWindow(input.inboxDir, input.targetFile);
  if (window && windowShouldSeal(window, fileHash)) {
    return { kind: 'compose', batch: sealWindow(input.inboxDir, window) };
  }
  const opened = window && window.baseHash === fileHash ? window : openWindow(input, fileBytes, fileHash, windowMs, maxBatch);
  const proposal = mustProposal(input);
  if (!opened.members.some((member) => member.proposalId === input.proposalId)) {
    const late = proposal.baseHash !== opened.baseHash;
    opened.members.push({ proposalId: input.proposalId, arrivedAt: Date.now(), late });
    proposal.late = late;
    proposal.stages = appendStage(proposal.stages, 'batch');
    writeProposal(input.inboxDir, proposal);
  }
  writeWindow(input.inboxDir, opened);
  if (windowShouldSeal(opened, fileHash) || opened.composeWindowMs === 0) {
    return { kind: 'compose', batch: sealWindow(input.inboxDir, opened) };
  }
  return { kind: 'wait' };
}

function windowShouldSeal(window: ComposeWindowRecord, fileHash: string): boolean {
  if (window.baseHash !== fileHash) return true;
  if (Date.now() >= window.expiresAt) return true;
  return window.members.length >= window.maxBatchSize;
}

function openWindow(
  input: SubmitSharedComposeInput,
  fileBytes: string,
  fileHash: string,
  windowMs: number,
  maxBatch: number
): ComposeWindowRecord {
  const openedAt = Date.now();
  const window: ComposeWindowRecord = {
    windowId: composeToken('win'),
    targetFile: input.targetFile,
    targetPath: input.targetPath,
    baseHash: fileHash,
    baseBytes: fileBytes,
    openedAt,
    expiresAt: openedAt + Math.max(0, windowMs),
    composeWindowMs: Math.max(0, windowMs),
    maxBatchSize: Math.max(1, maxBatch),
    members: [],
    state: 'open'
  };
  writeWindow(input.inboxDir, window);
  return window;
}

function sealWindow(inboxDir: string, window: ComposeWindowRecord): ComposeBatchRecord {
  const batch: ComposeBatchRecord = {
    batchId: composeToken('batch'),
    windowId: window.windowId,
    targetFile: window.targetFile,
    targetPath: window.targetPath,
    baseHash: window.baseHash,
    baseBytes: window.baseBytes,
    openedAt: window.openedAt,
    sealedAt: Date.now(),
    arrivals: window.members.map((member) => ({ ...member })),
    batchSize: window.members.length,
    status: 'composing',
    memberTerminal: true,
    composeVerdict: null,
    diagnosticComposeVerdict: null,
    candidate: null,
    terminal: null,
    detail: null
  };
  writeBatch(inboxDir, batch);
  deleteWindow(inboxDir, window.targetFile);
  return batch;
}

interface ComposeOutcome {
  readonly ok: boolean;
  readonly candidate: string | null;
  readonly verdict: 'compatible' | 'conflict' | 'error';
  readonly detail: string | null;
  readonly diagnostic: string | null;
}

function composeBatch(inboxDir: string, batch: ComposeBatchRecord): ComposeOutcome {
  const members = batch.arrivals.map((arrival) => {
    const proposal = readProposal(inboxDir, arrival.proposalId);
    if (!proposal) {
      throw new Error(`找不到提案 ${arrival.proposalId}`);
    }
    proposal.stages = appendStage(proposal.stages, 'compose');
    writeProposal(inboxDir, proposal);
    return proposal;
  });
  const diagnostic = diagnosticVerdict(members);
  const merged = composeMembersAgainstBase(batch.baseBytes, members.map((member) => ({
    proposalId: member.proposalId,
    baseBytes: member.baseBytes,
    patch: member.patch
  })));
  if (!merged.ok) {
    return { ok: false, candidate: null, verdict: merged.verdict, detail: merged.detail, diagnostic };
  }
  return { ok: true, candidate: merged.content, verdict: 'compatible', detail: null, diagnostic };
}

function diagnosticVerdict(members: readonly StoredComposeProposal[]): string | null {
  try {
    const result = composeBrokerProposals(members.map(toPatchProposal));
    return result.mergePlan.verdict;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function commitComposed(input: SubmitSharedComposeInput, batchId: string, outcome: ComposeOutcome): 'ok' | 'requeue' {
  const batch = readBatch(input.inboxDir, batchId);
  if (!batch) return 'ok';
  if (batch.status === 'committed' || batch.status === 'rejected') {
    writeMemberReceipts(input.inboxDir, batch);
    return 'ok';
  }
  if (batch.status === 'committing' && batch.candidate !== null) {
    resumeCommit(input.inboxDir, batch.batchId);
    return 'ok';
  }
  if (!outcome.ok || outcome.candidate === null) {
    batch.status = 'rejected';
    batch.memberTerminal = true;
    batch.composeVerdict = outcome.verdict === 'conflict' ? 'conflict' : 'error';
    batch.diagnosticComposeVerdict = outcome.diagnostic;
    batch.terminal = outcome.verdict === 'conflict' ? 'rejected-conflict' : 'error';
    batch.detail = outcome.detail;
    batch.candidate = null;
    writeBatch(input.inboxDir, batch);
    writeMemberReceipts(input.inboxDir, batch);
    return 'ok';
  }

  const fileBytes = readTargetText(batch.targetPath);
  const fileHash = hashComposeBytes(fileBytes);
  if (fileHash === hashComposeBytes(outcome.candidate)) {
    markCommitted(input.inboxDir, batch, outcome);
    return 'ok';
  }
  if (fileHash !== batch.baseHash) {
    batch.status = 'superseded';
    batch.memberTerminal = false;
    batch.terminal = 'rejected-hash-drift';
    batch.detail = `observed ${fileHash}`;
    batch.diagnosticComposeVerdict = outcome.diagnostic;
    writeBatch(input.inboxDir, batch);
    for (const arrival of batch.arrivals) {
      const proposal = readProposal(input.inboxDir, arrival.proposalId);
      if (!proposal) continue;
      proposal.hashDriftCount += 1;
      proposal.stages = appendStage(proposal.stages, 'commit');
      writeProposal(input.inboxDir, proposal);
    }
    return 'requeue';
  }

  batch.candidate = outcome.candidate;
  batch.status = 'committing';
  batch.composeVerdict = 'compatible';
  batch.diagnosticComposeVerdict = outcome.diagnostic;
  writeBatch(input.inboxDir, batch);
  const tempPath = atomicWriteText(batch.targetPath, outcome.candidate);
  const involved = batch.arrivals.some((arrival) => arrival.proposalId === input.proposalId);
  if (involved) input.onBeforeCommit?.();
  commitTempFile(tempPath, batch.targetPath);
  markCommitted(input.inboxDir, batch, outcome);
  return 'ok';
}

function resumeCommit(inboxDir: string, batchId: string): void {
  const batch = readBatch(inboxDir, batchId);
  if (!batch || batch.candidate === null) return;
  if (batch.status === 'committed' || batch.status === 'rejected') {
    writeMemberReceipts(inboxDir, batch);
    return;
  }
  removeComposeTempFiles([dirnameOf(batch.targetPath)]);
  const fileBytes = readTargetText(batch.targetPath);
  const fileHash = hashComposeBytes(fileBytes);
  const candidateHash = hashComposeBytes(batch.candidate);
  if (fileHash === candidateHash) {
    markCommitted(inboxDir, batch, {
      ok: true,
      candidate: batch.candidate,
      verdict: 'compatible',
      detail: null,
      diagnostic: batch.diagnosticComposeVerdict
    });
    return;
  }
  if (fileHash !== batch.baseHash) {
    batch.status = 'superseded';
    batch.memberTerminal = false;
    batch.terminal = 'rejected-hash-drift';
    batch.detail = `observed ${fileHash}`;
    writeBatch(inboxDir, batch);
    return;
  }
  const tempPath = atomicWriteText(batch.targetPath, batch.candidate);
  commitTempFile(tempPath, batch.targetPath);
  markCommitted(inboxDir, batch, {
    ok: true,
    candidate: batch.candidate,
    verdict: 'compatible',
    detail: null,
    diagnostic: batch.diagnosticComposeVerdict
  });
}

function markCommitted(inboxDir: string, batch: ComposeBatchRecord, outcome: ComposeOutcome): void {
  batch.status = 'committed';
  batch.memberTerminal = true;
  batch.terminal = 'committed';
  batch.composeVerdict = 'compatible';
  batch.diagnosticComposeVerdict = outcome.diagnostic;
  batch.candidate = outcome.candidate;
  batch.detail = null;
  writeBatch(inboxDir, batch);
  writeMemberReceipts(inboxDir, batch);
}

function writeMemberReceipts(inboxDir: string, batch: ComposeBatchRecord): void {
  if (!batch.memberTerminal || !batch.terminal) return;
  const reachedCommit = batch.terminal === 'committed' || batch.terminal === 'rejected-hash-drift';
  for (const arrival of batch.arrivals) {
    const proposal = readProposal(inboxDir, arrival.proposalId);
    if (!proposal) continue;
    const stages = appendStage(proposal.stages, reachedCommit ? 'commit' : 'compose');
    proposal.stages = stages;
    writeProposal(inboxDir, proposal);
    writeReceipt(inboxDir, receiptFrom(proposal, {
      stage: stages[stages.length - 1] ?? 'compose',
      stagesReached: stages,
      batchId: batch.batchId,
      batchSize: batch.batchSize,
      baseHash: batch.baseHash,
      late: arrival.late,
      terminal: batch.terminal,
      detail: batch.detail,
      composeVerdict: batch.composeVerdict,
      diagnosticComposeVerdict: batch.diagnosticComposeVerdict
    }));
  }
}

function findActiveBatch(inboxDir: string, proposalId: string): ComposeBatchRecord | null {
  const matches = listBatches(inboxDir)
    .filter((batch) => batch.memberTerminal && batch.status !== 'superseded')
    .filter((batch) => batch.arrivals.some((arrival) => arrival.proposalId === proposalId))
    .sort((left, right) => right.sealedAt - left.sealedAt);
  return matches[0] ?? null;
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
    validators: [],
    rollback: 'discard'
  };
}

function receiptFrom(proposal: StoredComposeProposal, fields: Omit<SharedComposeReceipt, 'proposalId' | 'declaredBaseHash' | 'hashDriftCount'>): SharedComposeReceipt {
  return {
    proposalId: proposal.proposalId,
    declaredBaseHash: proposal.baseHash,
    hashDriftCount: proposal.hashDriftCount,
    ...fields
  };
}

function mustProposal(input: SubmitSharedComposeInput): StoredComposeProposal {
  const proposal = readProposal(input.inboxDir, input.proposalId);
  if (!proposal) throw new Error(`找不到提案 ${input.proposalId}`);
  return proposal;
}

function finishError(input: SubmitSharedComposeInput, error: unknown): SharedComposeReceipt {
  const proposal = readProposal(input.inboxDir, input.proposalId);
  const stages = proposal?.stages ?? ['admission'];
  const detail = error instanceof Error ? error.message : String(error);
  return writeReceipt(input.inboxDir, {
    proposalId: input.proposalId,
    stage: stages[stages.length - 1] ?? 'admission',
    stagesReached: stages,
    batchId: null,
    batchSize: null,
    baseHash: proposal?.baseHash ?? input.baseHash,
    declaredBaseHash: input.baseHash,
    late: proposal?.late ?? false,
    terminal: detail.includes('recovery-required') ? 'timeout' : 'error',
    detail,
    composeVerdict: null,
    diagnosticComposeVerdict: null,
    hashDriftCount: proposal?.hashDriftCount ?? 0
  });
}

function appendStage(stages: readonly ProposalStage[], stage: ProposalStage): ProposalStage[] {
  return stages.includes(stage) ? [...stages] : [...stages, stage];
}

function dirnameOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index <= 0 ? '.' : filePath.slice(0, index);
}

function isLockTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'StewardLockTimeoutError' || error.message.includes('recovery-required'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
