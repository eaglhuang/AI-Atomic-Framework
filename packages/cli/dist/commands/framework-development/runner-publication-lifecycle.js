import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRunnerPublicationReceipt } from './runner-publication-receipt.js';
import { normalizeRunnerPublicationReceiptRef as normalizeReceiptRef, readPublishedRunnerSealedSourceSha, readRunnerPublicationDirtyPaths as readDirtyPaths, readRunnerPublicationHeadSha as readHeadSha, readRunnerPublicationReceiptAtPath, readRunnerPublicationReceipts as readRunnerReceipts } from './runner-publication-residue.js';
export { reconcileReceiptOnlyRunnerPublicationResidue } from './runner-publication-residue.js';
import { captureRunnerBuildOutputSnapshot, deriveRunnerBuildOutputInventory, evaluateRunnerPublicationDisposition, planRunnerPublicationTakeover } from '../../_vendor/core/dist/broker/runner-build-output-inventory.js';
export function authorizeRunnerPublicationTakeover(input) {
    // Authority is checked above; the takeover plan must describe the physical dirty surface seen by the publisher.
    const snapshot = captureRunnerBuildOutputSnapshot({ cwd: input.cwd, buildTarget: input.buildTarget, currentTaskId: null, currentTaskAllowedFiles: [] });
    const plan = planRunnerPublicationTakeover({ sealedSourceSha: input.sealedSourceSha, snapshot });
    if (plan.entries.length === 0)
        throw new Error('ATM_RUNNER_PUBLICATION_PENDING: takeover requires at least one pre-existing generated publication member.');
    const receiptPath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.runner-publication-takeover.json`);
    // The plan digest remains provider-neutral, while the persisted evidence
    // carries semantic task identity required by protected-state consumers.
    // A filename is never authority.
    writeFileSync(receiptPath, `${JSON.stringify({ ...plan, taskId: input.taskId }, null, 2)}\n`, 'utf8');
    return plan;
}
const PHASE_ORDER = [
    'prepared',
    'reservation',
    'build-ready',
    'built-sealed',
    'publication-ready',
    'published',
    'receipt-archived'
];
/**
 * Validates the durable continuation authority for publishing a receipt after
 * its source task has closed.  The authority is the sealed queue/receipt
 * tuple, never a reopened task, actor override, or task-id exception.
 */
export function evaluateRunnerPublicationContinuation(input) {
    const mismatches = [
        input.queueMemberTaskIds.includes(input.taskId) ? null : 'queue-member-task',
        input.stewardWorkId === input.queueHeadStewardWorkId ? null : 'queue-head-work',
        input.sealedSourceSha === input.receiptSealedSourceSha ? null : 'sealed-source',
        input.inventoryDigest === input.receiptInventoryDigest ? null : 'output-inventory',
        /^sha256:[a-f0-9]{64}$/i.test(input.receiptDigest) ? null : 'receipt-digest',
    ].filter((entry) => entry !== null);
    return mismatches.length === 0
        ? {
            schemaId: 'atm.runnerPublicationContinuationDecision.v1',
            allowed: true,
            code: null,
            reason: 'Queue-head, sealed source, receipt digest, and output inventory form one durable publication continuation.',
        }
        : {
            schemaId: 'atm.runnerPublicationContinuationDecision.v1',
            allowed: false,
            code: 'ATM_RUNNER_PUBLICATION_CONTINUATION_MISMATCH',
            reason: `Publication continuation facts do not match: ${mismatches.join(', ')}.`,
        };
}
function buildReceipt(request, snapshot, disposition, now) {
    return buildRunnerPublicationReceipt({
        taskId: request.authority.taskId,
        laneSessionId: request.authority.laneSessionId,
        stewardActorId: request.authority.stewardActorId,
        sealedSourceSha: request.sealedSourceSha,
        generation: snapshot.generation,
        runnerBuildDigest: snapshot.runnerBuildDigest,
        manifestDigest: snapshot.manifestDigest,
        surfaces: request.surfaces,
        publicationCommitSha: snapshot.publicationCommitSha,
        remoteVisibility: request.remoteVisibility,
        receiptDisposition: disposition,
        issuedAt: now
    });
}
/**
 * Advance (or report) the sealed runner publication lifecycle by exactly one
 * governed phase. Fail-closed on missing queue-head ownership; idempotent on an
 * already-published generation.
 */
export function publishSealedRunner(request, snapshot) {
    const now = request.now ?? new Date().toISOString();
    const decide = (action, phase, allowed, reason, extra) => ({
        schemaId: 'atm.sealedRunnerPublicationDecision.v1',
        action,
        phase,
        allowed,
        errorCode: extra?.errorCode ?? null,
        idempotent: extra?.idempotent ?? false,
        receipt: extra?.receipt ?? null,
        recoveryCommand: extra?.recoveryCommand ?? null,
        reason
    });
    // Idempotency: this generation was already published. Return the archived
    // receipt (or instruct archival) without re-publishing.
    if (snapshot.publishedGenerations.includes(snapshot.generation)) {
        if (snapshot.archivedReceiptPath) {
            return decide('complete', 'receipt-archived', true, 'Generation already published and receipt archived; publication is idempotent (no re-publish).', {
                idempotent: true,
                receipt: buildReceipt(request, snapshot, 'archived', now)
            });
        }
        return decide('archive-receipt', 'published', true, 'Generation already published; archive the canonical receipt as the governed terminal phase.', {
            idempotent: true,
            receipt: buildReceipt(request, snapshot, 'pending', now)
        });
    }
    const enqueueRecovery = `node atm.mjs broker runner-sync enqueue --task ${request.authority.taskId} --actor ${request.authority.stewardActorId} --sealed-source-sha ${request.sealedSourceSha} --surface release/atm-onefile/atm.mjs --surface release/atm-root-drop --json`;
    switch (snapshot.phase) {
        case 'prepared':
            return decide('build', 'prepared', true, 'Private candidate preparation holds no shared queue reservation; build and seal outside the publication mutex.');
        case 'reservation': {
            return decide('build', 'reservation', true, 'Legacy reservation state is treated as queue-free candidate preparation; build and seal before requesting publication.');
        }
        case 'build-ready':
            return decide('build', 'build-ready', true, 'Build the runner from the sealed source; frozen bootstrap validates against the newly built runner, not the stale one.');
        case 'built-sealed':
            return decide('seal', 'built-sealed', true, 'Runner built and sealed; compute build/manifest digests and prepare publication.');
        case 'publication-ready':
            if (!snapshot.queueHeadOwned) {
                return decide('reserve', 'publication-ready', false, 'Queue-head ownership is required only for the final shared publication mutation.', {
                    errorCode: 'ATM_RUNNER_SYNC_STEWARD_REQUIRED',
                    recoveryCommand: enqueueRecovery
                });
            }
            return decide('publish', 'publication-ready', true, 'Publish the sealed runner + generated manifest onto the declared surfaces.');
        case 'published':
            return decide('archive-receipt', 'published', true, 'Publication landed; archive the canonical receipt as the governed terminal phase.', {
                receipt: buildReceipt(request, snapshot, 'pending', now)
            });
        case 'receipt-archived':
            return decide('complete', 'receipt-archived', true, 'Lifecycle complete: receipt archived and generation recorded; further calls are idempotent no-ops.', {
                idempotent: true,
                receipt: buildReceipt(request, snapshot, 'archived', now)
            });
        default: {
            const exhaustive = snapshot.phase;
            throw new Error(`Unhandled publication phase: ${String(exhaustive)}`);
        }
    }
}
/** The next lifecycle phase after the given one, or null at the terminal phase. */
export function nextPublicationPhase(phase) {
    const index = PHASE_ORDER.indexOf(phase);
    return index >= 0 && index < PHASE_ORDER.length - 1 ? PHASE_ORDER[index + 1] : null;
}
/**
 * Filesystem/Git adapter for the pure BuildOutputInventory disposition rule.
 * It selects the receipt that actually names dirty runner artifacts, never an
 * unrelated task's evidence receipt.
 */
export function inspectRunnerPublicationDisposition(cwd, receiptRef) {
    const dirtyPaths = readDirtyPaths(cwd);
    const receipts = readRunnerReceipts(cwd);
    const requested = receiptRef ? normalizeReceiptRef(receiptRef) : null;
    const publishedSealedSourceSha = readPublishedRunnerSealedSourceSha(cwd);
    // A release transition is explicitly receipt-addressed.  Do not silently
    // fall back to directory discovery when its caller supplied one: test,
    // recovery, and alternate evidence roots are all legitimate as long as the
    // reference is repository-local and the receipt validates.  Discovery is a
    // convenience only for callers that did not name a receipt.
    const selected = (requested
        ? readRunnerPublicationReceiptAtPath(cwd, requested)
        : null) ?? receipts.find((candidate) => {
        // A historical receipt can name the same generated output as the current
        // runner.  Once the release manifest binds that runner to a sealed source,
        // path overlap alone is not authority to select older evidence.
        if (publishedSealedSourceSha !== null && candidate.inventory.sealedSourceSha !== publishedSealedSourceSha) {
            return false;
        }
        const members = new Set(candidate.inventory.entries.map((entry) => entry.path));
        return dirtyPaths.some((entry) => members.has(entry));
    }) ?? null;
    const inventory = selected?.inventory ?? deriveRunnerBuildOutputInventory({
        sealedSourceSha: readHeadSha(cwd),
        observedPaths: []
    });
    const terminalDisposition = selected?.terminalDisposition ?? null;
    const report = evaluateRunnerPublicationDisposition({ inventory, dirtyPaths, terminalDisposition });
    const code = report.disposition === 'publication-pending'
        ? 'ATM_RUNNER_PUBLICATION_PENDING'
        : report.disposition === 'inventory-incomplete'
            ? 'ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE'
            : null;
    return {
        schemaId: 'atm.runnerPublicationInspection.v1',
        ok: report.ok,
        code,
        receiptPath: selected?.path ?? null,
        sealedSourceSha: selected?.inventory.sealedSourceSha ?? null,
        report
    };
}
