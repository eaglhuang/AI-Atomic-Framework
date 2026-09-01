import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRunnerPublicationReceipt } from './runner-publication-receipt.js';
import { captureRunnerBuildOutputSnapshot, deriveRunnerBuildOutputInventory, evaluateRunnerPublicationDisposition, planRunnerPublicationTakeover, validateRunnerBuildOutputInventory } from '../../../../core/dist/broker/runner-build-output-inventory.js';
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
        ? readRunnerReceiptAtPath(cwd, requested)
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
function readRunnerReceiptAtPath(cwd, receiptRef) {
    const absolute = path.resolve(cwd, receiptRef);
    if (!absolute.startsWith(path.resolve(cwd) + path.sep) || !existsSync(absolute))
        return null;
    try {
        const document = JSON.parse(readFileSync(absolute, 'utf8'));
        const validated = validateRunnerBuildOutputInventory(document.outputInventory);
        if (!validated.ok || !validated.inventory)
            return null;
        const disposition = document.publicationDisposition;
        return {
            path: receiptRef,
            inventory: validated.inventory,
            terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null
        };
    }
    catch {
        return null;
    }
}
/**
 * The sole controlled terminal route for one stale runner-sync receipt. It is
 * deliberately narrower than generic filesystem cleanup: it restores a named
 * receipt only when its committed predecessor verifies, or deletes an untracked
 * orphan only when the exact inventory is otherwise clean. Unrelated evidence
 * is never examined as runner output.
 */
export function reconcileReceiptOnlyRunnerPublicationResidue(input) {
    const receiptRef = normalizeReceiptRef(input.receiptRef);
    const legacyTaskId = taskIdFromRunnerReceiptPath(receiptRef);
    if (!legacyTaskId) {
        throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: reconciliation accepts only a repository-local runner-sync receipt path with attributable task identity.');
    }
    const absoluteReceipt = path.join(input.cwd, receiptRef);
    if (!existsSync(absoluteReceipt)) {
        throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt does not exist: ${receiptRef}.`);
    }
    const currentRaw = readFileSync(absoluteReceipt, 'utf8');
    const currentDocument = parseRunnerReceipt(currentRaw, receiptRef);
    const currentInventory = currentDocument.inventory;
    if (String(currentDocument.document.taskId ?? '') !== legacyTaskId) {
        throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt task attribution does not match ${receiptRef}.`);
    }
    const stewardWorkId = typeof currentDocument.document.stewardWorkId === 'string'
        ? currentDocument.document.stewardWorkId.trim()
        : '';
    if (!stewardWorkId) {
        throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is missing stewardWorkId.');
    }
    if (input.activeStewardWorkIds.includes(stewardWorkId)) {
        throw new Error(`ATM_RUNNER_SYNC_RESUME_REQUIRED: receipt ${receiptRef} belongs to active steward work ${stewardWorkId}; publish or release it instead of reconciling.`);
    }
    const dirtyPaths = readDirtyPaths(input.cwd);
    const report = evaluateRunnerPublicationDisposition({ inventory: currentInventory, dirtyPaths });
    const dirtyInventoryPaths = report.dirtyInventoryPaths;
    if (report.extraOutputPaths.length > 0 || dirtyInventoryPaths.length !== 1 || dirtyInventoryPaths[0] !== receiptRef) {
        throw new Error(`ATM_RUNNER_PUBLICATION_PENDING: reconciliation requires ${receiptRef} to be the sole dirty inventory member and all generated outputs to be clean.`);
    }
    const dirtyBeforeDigest = digestText(currentRaw);
    const committedRaw = tryReadGitFileAtHead(input.cwd, receiptRef);
    let expectedHeadDigest = null;
    let restoredAfterDigest = null;
    let decision;
    let reconciledInventory = currentInventory;
    if (committedRaw === null) {
        if (!isUntrackedPath(input.cwd, receiptRef)) {
            throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: ${receiptRef} has no committed predecessor and is not an untracked orphan.`);
        }
        rmSync(absoluteReceipt);
        decision = 'deleted-untracked-orphan';
    }
    else {
        const committedDocument = parseRunnerReceipt(committedRaw, receiptRef);
        if (String(committedDocument.document.taskId ?? '') !== legacyTaskId) {
            throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: committed predecessor task attribution does not match ${receiptRef}.`);
        }
        expectedHeadDigest = digestText(committedRaw);
        reconciledInventory = committedDocument.inventory;
        decision = currentRaw === committedRaw ? 'already-restored' : 'restored-from-head';
        if (decision === 'restored-from-head') {
            writeFileSync(absoluteReceipt, committedRaw, 'utf8');
        }
        restoredAfterDigest = digestText(readFileSync(absoluteReceipt, 'utf8'));
    }
    const reconciliation = {
        schemaId: 'atm.runnerPublicationReceiptReconciliation.v1',
        taskId: input.taskId,
        actorId: input.actorId,
        legacyReceiptPath: receiptRef,
        legacyTaskId,
        expectedHeadDigest,
        dirtyBeforeDigest,
        restoredAfterDigest,
        legacyInventoryDigest: reconciledInventory.digest,
        sealedSourceSha: reconciledInventory.sealedSourceSha,
        decision,
        reconciledAt: input.now ?? new Date().toISOString()
    };
    appendRunnerPublicationRecovery(input.cwd, reconciliation);
    return reconciliation;
}
function readDirtyPaths(cwd) {
    const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
    if ((result.status ?? 1) !== 0)
        return [];
    return String(result.stdout ?? '').split(/\r?\n/)
        .map((line) => line.length >= 4 ? line.slice(3).replace(/\\/g, '/').trim() : '')
        .filter(Boolean);
}
function readHeadSha(cwd) {
    const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
    return (result.status ?? 1) === 0 ? String(result.stdout ?? '').trim() : 'unknown';
}
function readPublishedRunnerSealedSourceSha(cwd) {
    const manifestPath = path.join(cwd, 'release', 'atm-onefile', 'release-manifest.json');
    if (!existsSync(manifestPath))
        return null;
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const sealedSourceCommit = typeof manifest.sealedSourceCommit === 'string'
            ? manifest.sealedSourceCommit.trim().toLowerCase()
            : '';
        return /^[a-f0-9]{40,64}$/.test(sealedSourceCommit) ? sealedSourceCommit : null;
    }
    catch {
        return null;
    }
}
function readRunnerReceipts(cwd) {
    const evidenceRoot = path.join(cwd, '.atm', 'history', 'evidence');
    if (!existsSync(evidenceRoot))
        return [];
    return readdirSync(evidenceRoot)
        .filter((entry) => entry.endsWith('.runner-sync-receipt.json'))
        .map((entry) => path.join(evidenceRoot, entry))
        .map((absolute) => {
        try {
            const document = JSON.parse(readFileSync(absolute, 'utf8'));
            const validated = validateRunnerBuildOutputInventory(document.outputInventory);
            if (!validated.ok || !validated.inventory)
                return null;
            const disposition = document.publicationDisposition;
            return {
                path: path.relative(cwd, absolute).replace(/\\/g, '/'),
                inventory: validated.inventory,
                terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null,
                mtimeMs: statSync(absolute).mtimeMs
            };
        }
        catch {
            return null;
        }
    })
        .filter((entry) => entry !== null)
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .map(({ mtimeMs: _mtimeMs, ...entry }) => entry);
}
function normalizeReceiptRef(value) {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
        throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt reference must be a repository-local path.');
    }
    return normalized;
}
function taskIdFromRunnerReceiptPath(receiptRef) {
    // The filename is an attribution hint only. The receipt's taskId is checked
    // against this value before any recovery write, so accept every canonical
    // hyphenated work-item family instead of coupling recovery to two prefixes.
    const match = /^\.atm\/history\/evidence\/([A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)+)\.runner-sync-receipt\.json$/i.exec(receiptRef);
    return match?.[1] ?? null;
}
function parseRunnerReceipt(raw, receiptRef) {
    let document;
    try {
        document = JSON.parse(raw);
    }
    catch {
        throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is not valid JSON: ${receiptRef}.`);
    }
    if (document.schemaId !== 'atm.runnerSyncReceipt.v1') {
        throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt schema is invalid: ${receiptRef}.`);
    }
    const validated = validateRunnerBuildOutputInventory(document.outputInventory);
    if (!validated.ok || !validated.inventory) {
        throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt inventory is invalid: ${validated.reason ?? receiptRef}.`);
    }
    return { document, inventory: validated.inventory };
}
function tryReadGitFileAtHead(cwd, receiptRef) {
    // `cat-file blob` has a single, machine-oriented output contract. Unlike
    // `git show`, it cannot inject commit headers or invoke text conversion.
    const result = spawnSync('git', ['cat-file', 'blob', `HEAD:${receiptRef}`], {
        cwd,
        encoding: 'utf8',
        // Runner-sync receipts enumerate release trees and routinely exceed the
        // Node default 1 MiB child-process buffer.
        maxBuffer: 16 * 1024 * 1024
    });
    if ((result.status ?? 1) !== 0) {
        return null;
    }
    return String(result.stdout ?? '');
}
function isUntrackedPath(cwd, receiptRef) {
    const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', receiptRef], { cwd, encoding: 'utf8' });
    if ((result.status ?? 1) !== 0)
        return false;
    return String(result.stdout ?? '').split(/\r?\n/).some((line) => line.startsWith('?? ') && line.slice(3).replace(/\\/g, '/').trim() === receiptRef);
}
function appendRunnerPublicationRecovery(cwd, reconciliation) {
    const recoveryPath = path.join(cwd, '.atm', 'history', 'evidence', `${reconciliation.taskId}.runner-publication-recovery.json`);
    mkdirSync(path.dirname(recoveryPath), { recursive: true });
    const records = readRecoveryRecords(recoveryPath, reconciliation.taskId);
    const duplicate = records.some((record) => record.legacyReceiptPath === reconciliation.legacyReceiptPath
        && record.dirtyBeforeDigest === reconciliation.dirtyBeforeDigest
        && record.decision === reconciliation.decision);
    const ledger = {
        schemaId: 'atm.runnerPublicationRecoveryLedger.v1',
        taskId: reconciliation.taskId,
        records: duplicate ? records : [...records, reconciliation]
    };
    writeFileSync(recoveryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}
function readRecoveryRecords(recoveryPath, taskId) {
    if (!existsSync(recoveryPath))
        return [];
    try {
        const existing = JSON.parse(readFileSync(recoveryPath, 'utf8'));
        if (existing.schemaId === 'atm.runnerPublicationRecoveryLedger.v1'
            && existing.taskId === taskId
            && Array.isArray(existing.records)) {
            return existing.records;
        }
        if (existing.schemaId === 'atm.runnerPublicationReceiptReconciliation.v1') {
            return [existing];
        }
    }
    catch {
        // A malformed recovery file is not a valid basis for a destructive recovery.
    }
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: recovery ledger is invalid for ${taskId}.`);
}
function digestText(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
