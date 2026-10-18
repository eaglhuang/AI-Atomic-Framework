// Compose, atomic rename, and per-member receipts.
import { appendProposalStage } from './shared-compose-inbox-contract.js';
import { atomicWriteText, commitTempFile, hashComposeBytes, liveEntryPoints, parentDir, readBatch, readProposal, readReceipt, readTargetText, removeComposeTempFiles, writeBatch, writeProposal, writeReceipt } from './shared-compose-inbox-fs.js';
import { materializeMember, selectArrivalOrderMaximalSubset } from './shared-compose-inbox-merge.js';
import { diagnosticVerdict, effectiveStopAt, proposalClockStopReason, receiptFrom, settleTerminal } from './shared-compose-inbox-receipt.js';
export function composeBatch(inboxDir, batch) {
    const ready = [];
    const errors = [];
    const stored = [];
    for (const arrival of batch.arrivals) {
        const proposal = readProposal(inboxDir, arrival.proposalId);
        if (!proposal)
            throw new Error(`找不到提案 ${arrival.proposalId}`);
        proposal.stages = appendProposalStage(proposal.stages, 'compose');
        writeProposal(inboxDir, proposal);
        stored.push(proposal);
        const made = materializeMember({
            proposalId: proposal.proposalId,
            arrivedAt: arrival.arrivedAt,
            baseBytes: proposal.baseBytes,
            patch: proposal.patch
        });
        if (!made.ok)
            errors.push({ proposalId: proposal.proposalId, detail: made.detail });
        else
            ready.push(made.ready);
    }
    return {
        selection: selectArrivalOrderMaximalSubset(batch.baseBytes, ready),
        errors,
        diagnostic: diagnosticVerdict(stored)
    };
}
export function commitComposed(input, batchId, outcome, now) {
    const batch = readBatch(input.inboxDir, batchId);
    if (!batch)
        return { kind: 'ok', receipt: null };
    if (batch.status === 'committed' || batch.status === 'rejected') {
        writeMemberReceipts(input, batch, outcome, now);
        return { kind: 'ok', receipt: readReceipt(input.inboxDir, input.proposalId) };
    }
    if (batch.status === 'committing' && batch.candidate !== null) {
        resumeCommit(input.inboxDir, batch.batchId, now);
        return { kind: 'ok', receipt: readReceipt(input.inboxDir, input.proposalId) };
    }
    input.onBeforeHashCheck?.();
    const fileHash = hashComposeBytes(readTargetText(batch.targetPath));
    if (fileHash !== batch.baseHash) {
        batch.status = 'superseded';
        batch.memberTerminal = false;
        batch.detail = `observed ${fileHash}`;
        batch.diagnosticComposeVerdict = outcome.diagnostic;
        writeBatch(input.inboxDir, batch);
        for (const arrival of batch.arrivals) {
            const proposal = readProposal(input.inboxDir, arrival.proposalId);
            if (!proposal)
                continue;
            proposal.hashDriftCount += 1;
            proposal.stages = appendProposalStage(proposal.stages, 'commit');
            writeProposal(input.inboxDir, proposal);
        }
        return { kind: 'requeue', receipt: null };
    }
    if (memberPastStop(input.inboxDir, batch, now())) {
        return { kind: 'ok', receipt: rejectUnrenamed(input, batch, outcome, 'timeout', now) };
    }
    applyOutcome(batch, outcome);
    if (outcome.selection.content === null) {
        batch.status = 'rejected';
        batch.candidate = null;
        batch.terminal = batch.errorIds.length > 0 && batch.rejectedIds.length === 0 ? 'error' : 'rejected-conflict';
        batch.composeVerdict = batch.terminal === 'error' ? 'error' : 'conflict';
        writeBatch(input.inboxDir, batch);
        writeMemberReceipts(input, batch, outcome, now);
        return { kind: 'ok', receipt: readReceipt(input.inboxDir, input.proposalId) };
    }
    batch.candidate = outcome.selection.content;
    batch.status = 'committing';
    batch.composeVerdict = batch.rejectedIds.length > 0 || batch.errorIds.length > 0 ? 'mixed' : 'compatible';
    batch.diagnosticComposeVerdict = outcome.diagnostic;
    writeBatch(input.inboxDir, batch);
    const tempPath = atomicWriteText(batch.targetPath, outcome.selection.content);
    if (batch.arrivals.some((arrival) => arrival.proposalId === input.proposalId))
        input.onBeforeCommit?.();
    commitTempFile(tempPath, batch.targetPath);
    input.onAfterRename?.();
    batch.renameCount += 1;
    batch.renameAt = now();
    const observed = readTargetText(batch.targetPath);
    batch.resultHash = hashComposeBytes(observed);
    const candidateHash = hashComposeBytes(outcome.selection.content);
    if (batch.resultHash !== candidateHash) {
        batch.status = 'rejected';
        batch.terminal = 'inconsistent';
        batch.detail = 'renamed bytes do not match the composed candidate';
    }
    else {
        batch.status = 'committed';
        batch.terminal = 'committed';
        batch.detail = null;
    }
    writeBatch(input.inboxDir, batch);
    if (input.suppressAck) {
        const preview = previewReceipt(input, batch, outcome, now, null);
        return { kind: 'ok', receipt: preview };
    }
    input.onBeforeAck?.();
    writeMemberReceipts(input, batch, outcome, now);
    return { kind: 'ok', receipt: readReceipt(input.inboxDir, input.proposalId) };
}
export function resumeCommit(inboxDir, batchId, now) {
    const batch = readBatch(inboxDir, batchId);
    if (!batch || batch.candidate === null)
        return [];
    if (batch.status === 'committed' || batch.status === 'rejected')
        return [];
    const removed = removeComposeTempFiles([parentDir(batch.targetPath)]);
    const observed = readTargetText(batch.targetPath);
    const fileHash = hashComposeBytes(observed);
    const candidateHash = hashComposeBytes(batch.candidate);
    if (fileHash === candidateHash) {
        if (batch.renameCount < 1)
            batch.renameCount = 1;
        if (batch.renameAt === null)
            batch.renameAt = now();
        batch.resultHash = fileHash;
        batch.status = 'committed';
        batch.memberTerminal = true;
        batch.terminal = 'committed';
        writeBatch(inboxDir, batch);
        writeMemberReceipts(bareInput(inboxDir, batch), batch, null, now);
        return removed;
    }
    if (fileHash !== batch.baseHash) {
        batch.status = 'superseded';
        batch.memberTerminal = false;
        batch.detail = `observed ${fileHash}`;
        writeBatch(inboxDir, batch);
        return removed;
    }
    if (memberPastStop(inboxDir, batch, now())) {
        rejectUnrenamed(bareInput(inboxDir, batch), batch, null, 'timeout', now);
        return removed;
    }
    const tempPath = atomicWriteText(batch.targetPath, batch.candidate);
    commitTempFile(tempPath, batch.targetPath);
    batch.renameCount += 1;
    batch.renameAt = now();
    batch.resultHash = hashComposeBytes(readTargetText(batch.targetPath));
    batch.status = batch.resultHash === candidateHash ? 'committed' : 'rejected';
    batch.memberTerminal = true;
    batch.terminal = batch.status === 'committed' ? 'committed' : 'inconsistent';
    writeBatch(inboxDir, batch);
    writeMemberReceipts(bareInput(inboxDir, batch), batch, null, now);
    return removed;
}
function applyOutcome(batch, outcome) {
    batch.acceptedIds = outcome.selection.accepted.map((member) => member.proposalId);
    batch.rejectedIds = outcome.selection.rejected.map((member) => member.proposalId);
    batch.errorIds = outcome.errors.map((member) => member.proposalId);
    batch.rejectionDetails = Object.fromEntries(outcome.selection.rejected.map((member) => [member.proposalId, member.detail]));
    batch.errorDetails = Object.fromEntries(outcome.errors.map((member) => [member.proposalId, member.detail]));
    batch.diagnosticComposeVerdict = outcome.diagnostic;
}
export function writeMemberReceipts(input, batch, outcome, now) {
    if (!batch.memberTerminal || !batch.terminal)
        return;
    const ackAt = now();
    for (const arrival of batch.arrivals) {
        const proposal = readProposal(input.inboxDir, arrival.proposalId);
        if (!proposal)
            continue;
        const intended = intendedTerminal(batch, proposal, now());
        const reachedCommit = intended.terminal === 'committed' || intended.terminal === 'inconsistent';
        proposal.stages = appendProposalStage(proposal.stages, reachedCommit ? 'commit' : 'compose');
        writeProposal(input.inboxDir, proposal);
        const observed = batch.resultHash;
        const settled = settleTerminal({
            renameAt: intended.renamed ? batch.renameAt : null,
            ackAt,
            effectiveStop: effectiveStopAt(proposal),
            intended: intended.terminal,
            intendedReason: intended.reason,
            resultHash: observed,
            observedHash: observed
        });
        const live = liveEntryPoints(input.inboxDir).length > 0;
        const terminal = live ? 'reconciliation-incomplete' : settled.terminal;
        writeReceipt(input.inboxDir, receiptFrom(proposal, batch, {
            stage: proposal.stages[proposal.stages.length - 1] ?? 'compose',
            stagesReached: proposal.stages,
            terminal,
            resolvedTerminal: live ? settled.terminal : null,
            resolvedStopReason: live ? settled.stopReason : null,
            stopReason: live ? 'entry-points-still-live' : settled.stopReason,
            detail: memberDetail(batch, proposal.proposalId, outcome),
            ackAt: live ? null : ackAt,
            elapsedMs: Math.max(0, (live ? now() : ackAt) - proposal.firstSubmittedAt),
            renamed: intended.renamed && batch.renameAt !== null,
            now
        }));
    }
}
function previewReceipt(input, batch, outcome, now, ackAt) {
    const proposal = readProposal(input.inboxDir, input.proposalId);
    if (!proposal)
        return null;
    const intended = intendedTerminal(batch, proposal, now());
    const settled = settleTerminal({
        renameAt: intended.renamed ? batch.renameAt : null,
        ackAt,
        effectiveStop: effectiveStopAt(proposal),
        intended: intended.terminal,
        intendedReason: intended.reason,
        resultHash: batch.resultHash,
        observedHash: batch.resultHash
    });
    return receiptFrom(proposal, batch, {
        stage: 'commit',
        stagesReached: appendProposalStage(proposal.stages, 'commit'),
        terminal: settled.terminal,
        resolvedTerminal: null,
        resolvedStopReason: null,
        stopReason: settled.stopReason,
        detail: memberDetail(batch, proposal.proposalId, outcome),
        ackAt,
        elapsedMs: Math.max(0, now() - proposal.firstSubmittedAt),
        renamed: intended.renamed && batch.renameAt !== null,
        now
    });
}
function intendedTerminal(batch, proposal, nowMs) {
    const proposalId = proposal.proposalId;
    if (batch.terminal === 'inconsistent')
        return { terminal: 'inconsistent', reason: 'hash-mismatch', renamed: true };
    if (batch.terminal === 'timeout')
        return { terminal: 'timeout', reason: proposalClockStopReason(proposal, nowMs), renamed: false };
    if (batch.errorIds.includes(proposalId))
        return { terminal: 'error', reason: 'error', renamed: false };
    if (batch.acceptedIds.includes(proposalId))
        return { terminal: 'committed', reason: 'acked-in-window', renamed: true };
    if (batch.rejectedIds.includes(proposalId))
        return { terminal: 'rejected-conflict', reason: rejectionReason(batch, proposalId), renamed: false };
    return { terminal: batch.terminal ?? 'error', reason: 'error', renamed: batch.renameAt !== null };
}
function rejectionReason(batch, proposalId) {
    const detail = batch.rejectionDetails[proposalId];
    if (detail === 'excluded-by-arrival-maximal-subset')
        return 'excluded-by-arrival-maximal-subset';
    if (detail === 'legal-proof-limit')
        return 'legal-proof-limit';
    return 'conflict';
}
function memberDetail(batch, proposalId, outcome) {
    if (batch.errorDetails[proposalId])
        return batch.errorDetails[proposalId] ?? null;
    const rejected = batch.rejectionDetails[proposalId] ?? outcome?.selection.rejected.find((member) => member.proposalId === proposalId)?.detail ?? null;
    return rejected ?? batch.detail;
}
function rejectUnrenamed(input, batch, outcome, terminal, now) {
    batch.status = 'rejected';
    batch.memberTerminal = true;
    batch.candidate = null;
    batch.terminal = terminal;
    batch.composeVerdict = 'error';
    if (outcome)
        applyOutcome(batch, outcome);
    writeBatch(input.inboxDir, batch);
    writeMemberReceipts(input, batch, outcome, now);
    return readReceipt(input.inboxDir, input.proposalId);
}
function memberPastStop(inboxDir, batch, nowMs) {
    return batch.arrivals.some((arrival) => {
        const proposal = readProposal(inboxDir, arrival.proposalId);
        return proposal !== null && nowMs >= effectiveStopAt(proposal);
    });
}
export function bareInput(inboxDir, batch) {
    return {
        inboxDir,
        targetPath: batch.targetPath,
        targetFile: batch.targetFile,
        proposalId: batch.arrivals[0]?.proposalId ?? 'recover',
        taskId: 'recover',
        actorId: 'recover',
        baseHash: batch.baseHash,
        baseBytes: batch.baseBytes,
        patch: ''
    };
}
