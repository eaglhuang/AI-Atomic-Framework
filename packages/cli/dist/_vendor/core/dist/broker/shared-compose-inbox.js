// Cross-writer batch coordinator.
// composeWindowMs defaults to 0: one proposal, one batch, current file bytes.
// A positive window admits other writers that declare the same immutable base.
// Compatible proposals rename once. A conflict accepts an arrival-order maximal
// legal subset of whole proposals. See SHARED_COMPOSE_INBOX_CONTRACT.md.
import { SHARED_COMPOSE_CONTRACT, appendProposalStage } from './shared-compose-inbox-contract.js';
import { bareInput, commitComposed, composeBatch, resumeCommit, writeMemberReceipts } from './shared-compose-inbox-commit.js';
import { assertSafeId, composeToken, deleteWindow, ensureComposeInbox, hashComposeBytes, listBatches, liveEntryPoints, parentDir, readBatch, readEntryPoint, readReceipt, readTargetText, readWindow, removeComposeTempFiles, writeBatch, writeEntryPoint, writeProposal, writeReceipt, writeWindow, withComposeFileLock } from './shared-compose-inbox-fs.js';
import { consumeRetry, effectiveStopAt, ensureProposal, finishError, finishTimeout, mustProposal, rejectAdmission, retryExhausted, settleTerminal } from './shared-compose-inbox-receipt.js';
export { hashComposeBytes, SHARED_COMPOSE_CONTRACT };
const LOCK_WAIT_MS = SHARED_COMPOSE_CONTRACT.lockWaitMs;
export async function submitSharedComposeProposal(input) {
    assertSafeId(input.proposalId, 'proposalId');
    ensureComposeInbox(input.inboxDir);
    const now = () => input.now?.() ?? Date.now();
    const existing = readReceipt(input.inboxDir, input.proposalId);
    if (existing?.terminal === 'reconciliation-incomplete') {
        return reconcileSharedComposeProposal({ inboxDir: input.inboxDir, proposalId: input.proposalId, now });
    }
    if (existing)
        return existing;
    const proposal = ensureProposal(input, now());
    if (!proposal.admission.admitted)
        return rejectAdmission(input, proposal);
    const windowMs = input.composeWindowMs ?? SHARED_COMPOSE_CONTRACT.defaultComposeWindowMs;
    const maxBatch = input.maxBatchSize ?? SHARED_COMPOSE_CONTRACT.defaultMaxBatchSize;
    const staleMs = input.composingStaleMs ?? SHARED_COMPOSE_CONTRACT.defaultComposingStaleMs;
    while (true) {
        const ready = readReceipt(input.inboxDir, input.proposalId);
        if (ready?.terminal === 'reconciliation-incomplete') {
            return reconcileSharedComposeProposal({ inboxDir: input.inboxDir, proposalId: input.proposalId, now });
        }
        if (ready)
            return ready;
        const current = mustProposal(input);
        if (now() >= effectiveStopAt(current) && !findActiveBatch(input.inboxDir, input.proposalId)) {
            return finishTimeout(input, current, now());
        }
        let step;
        try {
            step = withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => pump(input, windowMs, maxBatch, staleMs, now));
        }
        catch (error) {
            if (!isLockTimeout(error))
                return finishError(input, error, now());
            if (!consumeRetry(input, now()))
                return retryExhausted(input, now());
            await delay(15);
            continue;
        }
        if (step.kind === 'receipt')
            return step.receipt;
        if (step.kind === 'wait') {
            await delay(15);
            continue;
        }
        if (step.kind === 'resume') {
            try {
                withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => resumeCommit(input.inboxDir, step.batch.batchId, now));
            }
            catch (error) {
                return finishError(input, error, now());
            }
            continue;
        }
        let outcome;
        try {
            outcome = composeBatch(input.inboxDir, step.batch);
        }
        catch (error) {
            return finishError(input, error, now());
        }
        let committed;
        try {
            committed = withComposeFileLock(input.inboxDir, input.targetFile, LOCK_WAIT_MS, () => commitComposed(input, step.batch.batchId, outcome, now));
        }
        catch (error) {
            return finishError(input, error, now());
        }
        if (committed.kind === 'requeue') {
            if (!consumeRetry(input, now()))
                return retryExhausted(input, now());
            continue;
        }
        if (committed.receipt)
            return committed.receipt;
        return finishError(input, new Error('commit produced no receipt'), now());
    }
}
export function recoverSharedComposeInbox(input) {
    if (!input.inboxDir)
        return { recoveredBatchIds: [], removedTempFiles: [] };
    ensureComposeInbox(input.inboxDir);
    const now = () => input.now?.() ?? Date.now();
    const staleMs = input.composingStaleMs ?? SHARED_COMPOSE_CONTRACT.defaultComposingStaleMs;
    const recovered = [];
    const removed = [];
    const tempDirs = new Set([input.inboxDir]);
    for (const batch of listBatches(input.inboxDir)) {
        tempDirs.add(parentDir(batch.targetPath));
        if (batch.status !== 'composing' && batch.status !== 'committing')
            continue;
        if (batch.status === 'composing' && !input.force && now() - batch.sealedAt < staleMs)
            continue;
        if (batch.status === 'committing') {
            removed.push(...withComposeFileLock(input.inboxDir, batch.targetFile, LOCK_WAIT_MS, () => resumeCommit(input.inboxDir, batch.batchId, now)));
            recovered.push(batch.batchId);
            continue;
        }
        const current = readBatch(input.inboxDir, batch.batchId);
        if (!current || current.status !== 'composing')
            continue;
        const outcome = composeBatch(input.inboxDir, current);
        const bare = bareInput(input.inboxDir, current);
        withComposeFileLock(input.inboxDir, current.targetFile, LOCK_WAIT_MS, () => commitComposed(bare, current.batchId, outcome, now));
        recovered.push(current.batchId);
    }
    removed.push(...removeComposeTempFiles([...tempDirs]));
    return { recoveredBatchIds: recovered, removedTempFiles: removed };
}
export function registerSharedComposeEntryPoint(inboxDir, entryPointId, pid = process.pid) {
    assertSafeId(entryPointId, 'entryPointId');
    ensureComposeInbox(inboxDir);
    writeEntryPoint(inboxDir, { entryPointId, pid, stoppedAt: null });
}
export function stopSharedComposeEntryPoint(inboxDir, entryPointId, stoppedAt = Date.now()) {
    assertSafeId(entryPointId, 'entryPointId');
    ensureComposeInbox(inboxDir);
    const existing = readEntryPoint(inboxDir, entryPointId);
    writeEntryPoint(inboxDir, {
        entryPointId,
        pid: existing?.pid ?? process.pid,
        stoppedAt
    });
}
export function reconcileSharedComposeProposal(input) {
    const now = input.now ?? (() => Date.now());
    const existing = readReceipt(input.inboxDir, input.proposalId);
    if (!existing)
        throw new Error(`找不到提案收據 ${input.proposalId}`);
    if (existing.terminal !== 'reconciliation-incomplete')
        return existing;
    if (liveEntryPoints(input.inboxDir).length > 0)
        return existing;
    const ackAt = now();
    const settled = settleTerminal({
        renameAt: existing.renameAt,
        ackAt,
        effectiveStop: existing.effectiveStopAt,
        intended: existing.resolvedTerminal ?? 'committed',
        intendedReason: existing.resolvedStopReason ?? 'acked-in-window',
        resultHash: existing.resultHash,
        observedHash: existing.resultHash
    });
    return writeReceipt(input.inboxDir, {
        ...existing,
        terminal: settled.terminal,
        stopReason: settled.stopReason,
        resolvedTerminal: null,
        resolvedStopReason: null,
        ackAt,
        elapsedMs: Math.max(0, ackAt - existing.firstSubmittedAt)
    });
}
function pump(input, windowMs, maxBatch, staleMs, now) {
    const receipt = readReceipt(input.inboxDir, input.proposalId);
    if (receipt)
        return { kind: 'receipt', receipt };
    const active = findActiveBatch(input.inboxDir, input.proposalId);
    if (active?.status === 'committed' || active?.status === 'rejected') {
        writeMemberReceipts(input, active, null, now);
        const written = readReceipt(input.inboxDir, input.proposalId);
        if (written)
            return { kind: 'receipt', receipt: written };
    }
    if (active?.status === 'committing')
        return { kind: 'resume', batch: active };
    if (active?.status === 'composing') {
        if (now() - active.sealedAt >= staleMs)
            return { kind: 'compose', batch: active };
        return { kind: 'wait' };
    }
    const fileBytes = readTargetText(input.targetPath);
    const fileHash = hashComposeBytes(fileBytes);
    const window = readWindow(input.inboxDir, input.targetFile);
    if (window && windowShouldSeal(window, fileHash, now())) {
        return { kind: 'compose', batch: sealWindow(input.inboxDir, window, now()) };
    }
    const proposal = mustProposal(input);
    if (window && proposal.baseHash === window.baseHash && window.baseHash === fileHash) {
        rememberMember(input.inboxDir, window, proposal, false);
        if (windowShouldSeal(window, fileHash, now()))
            return { kind: 'compose', batch: sealWindow(input.inboxDir, window, now()) };
        return { kind: 'wait' };
    }
    if (window && proposal.baseHash !== fileHash)
        return { kind: 'wait' };
    const opened = openWindow(input, fileBytes, fileHash, proposal.baseHash === fileHash ? windowMs : 0, maxBatch, now());
    rememberMember(input.inboxDir, opened, proposal, proposal.baseHash !== opened.baseHash);
    if (windowShouldSeal(opened, fileHash, now()))
        return { kind: 'compose', batch: sealWindow(input.inboxDir, opened, now()) };
    return { kind: 'wait' };
}
function windowShouldSeal(window, fileHash, nowMs) {
    if (window.baseHash !== fileHash)
        return true;
    if (nowMs >= window.expiresAt)
        return true;
    return window.members.length >= window.maxBatchSize;
}
function openWindow(input, fileBytes, fileHash, windowMs, maxBatch, nowMs) {
    const openedAt = nowMs;
    const boundedWindow = Math.max(0, windowMs);
    const window = {
        windowId: composeToken('win'),
        targetFile: input.targetFile,
        targetPath: input.targetPath,
        baseHash: fileHash,
        baseBytes: fileBytes,
        policyVersion: SHARED_COMPOSE_CONTRACT.policyVersion,
        openedAt,
        expiresAt: openedAt + boundedWindow,
        composeWindowMs: boundedWindow,
        maxBatchSize: Math.max(1, maxBatch),
        members: [],
        state: 'open'
    };
    writeWindow(input.inboxDir, window);
    return window;
}
function rememberMember(inboxDir, window, proposal, late) {
    if (!window.members.some((member) => member.proposalId === proposal.proposalId)) {
        window.members.push({ proposalId: proposal.proposalId, arrivedAt: proposal.arrivedAt, late });
        proposal.late = late;
        proposal.stages = appendProposalStage(proposal.stages, 'batch');
        writeProposal(inboxDir, proposal);
    }
    writeWindow(inboxDir, window);
}
function sealWindow(inboxDir, window, nowMs) {
    const seen = new Set();
    const arrivals = window.members.filter((member) => {
        if (seen.has(member.proposalId))
            return false;
        seen.add(member.proposalId);
        return true;
    });
    const batch = {
        batchId: composeToken('batch'),
        windowId: window.windowId,
        targetFile: window.targetFile,
        targetPath: window.targetPath,
        baseHash: window.baseHash,
        baseBytes: window.baseBytes,
        policyVersion: window.policyVersion,
        openedAt: window.openedAt,
        sealedAt: nowMs,
        arrivals,
        batchSize: arrivals.length,
        status: 'composing',
        memberTerminal: true,
        acceptedIds: [],
        rejectedIds: [],
        errorIds: [],
        rejectionDetails: {},
        errorDetails: {},
        composeVerdict: null,
        diagnosticComposeVerdict: null,
        candidate: null,
        renameCount: 0,
        renameAt: null,
        resultHash: null,
        terminal: null,
        detail: null
    };
    writeBatch(inboxDir, batch);
    deleteWindow(inboxDir, window.targetFile);
    return batch;
}
function findActiveBatch(inboxDir, proposalId) {
    const matches = listBatches(inboxDir)
        .filter((batch) => batch.status !== 'superseded')
        .filter((batch) => batch.arrivals.some((arrival) => arrival.proposalId === proposalId))
        .sort((left, right) => right.sealedAt - left.sealedAt);
    return matches[0] ?? null;
}
function isLockTimeout(error) {
    return error instanceof Error && (error.name === 'StewardLockTimeoutError' || error.message.includes('recovery-required'));
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
