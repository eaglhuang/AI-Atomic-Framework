import { rearbitrateLinkedSurfaceScope } from '../../../_vendor/core/dist/scope/linked-surface/index.js';
import { pathMatchesWriteScope } from '../../../_vendor/core/dist/broker/write-scope-policy.js';
import { CliError } from '../../shared.js';
export function buildScopeAmendmentRearbitration(input) {
    const current = new Set(input.currentScope.map((surface) => surface.replace(/\\/g, '/')));
    const amendmentPaths = input.closure.requiredSurfaces.filter((surface) => !current.has(surface));
    const rearbitration = rearbitrateLinkedSurfaceScope({
        closure: input.closure,
        ticketReadSet: input.ticketReadSet,
        ticketWriteSet: input.ticketWriteSet
    });
    return {
        schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1',
        ok: amendmentPaths.length === 0 && !rearbitration.required,
        errorCode: rearbitration.errorCode,
        amendmentPaths,
        rearbitration
    };
}
export function cloneAuthorityRecord(value) {
    return JSON.parse(JSON.stringify(value));
}
export function syncScopeAmendmentScopePaths(input) {
    const existing = Array.isArray(input.taskDocument.scopePaths)
        ? input.taskDocument.scopePaths.map((entry) => String(entry ?? '').replace(/\\/g, '/').trim()).filter((entry) => entry.length > 0)
        : [];
    const known = new Set(existing);
    const additions = input.mergedAllowed
        .map((entry) => String(entry ?? '').replace(/\\/g, '/').trim())
        .filter((entry) => entry.length > 0 && !known.has(entry));
    if (additions.length === 0)
        return;
    input.taskDocument.scopePaths = [...existing, ...additions];
}
export function syncScopeAmendmentRuntimeLock(input) {
    input.outerLock.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] };
    input.outerLock.files = [...input.mergedAllowed];
}
export function syncScopeAmendmentState(input) {
    syncScopeAmendmentRuntimeLock(input);
    input.taskDocument.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] };
    const claim = input.taskDocument.claim;
    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
        const claimRecord = claim;
        claimRecord.files = [...input.mergedAllowed];
        input.taskDocument.claim = claimRecord;
    }
    syncScopeAmendmentScopePaths(input);
}
export function readTicketWriteGrant(ticket) {
    if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket))
        return [];
    const grants = ticket.grants;
    if (!Array.isArray(grants))
        return [];
    const fileGrant = grants.find((grant) => grant && typeof grant === 'object' && grant.kind === 'file-write');
    const values = fileGrant && typeof fileGrant === 'object' ? fileGrant.values : null;
    return Array.isArray(values) ? values.map((entry) => String(entry)) : [];
}
export function assertTicketCoversAmendedScope(input) {
    const grant = readTicketWriteGrant(input.ticket);
    const missing = input.mergedAllowed.filter((path) => !grant.some((scope) => pathMatchesWriteScope(path, scope)));
    if (!input.ticket || missing.length > 0) {
        throw new CliError('ATM_WRITE_TICKET_SCOPE_VIOLATION', 'Requested mutation path is outside the ticket file grant.', {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                actorId: input.actorId,
                missingPaths: missing,
                requiredCommand: `node atm.mjs tasks scope add --task ${input.taskId} --add <path> --json`
            }
        });
    }
}
function replaceRecord(target, source) {
    for (const key of Object.keys(target)) {
        if (!(key in source))
            delete target[key];
    }
    Object.assign(target, source);
}
/**
 * Extraction proposal (ATM-GOV-0393): the scope-amendment transaction boundary
 * lives here. One canonical amended snapshot is projected to ledger, claim,
 * direction lock, and work-admission ticket, or no consumer-visible surface
 * changes. The legacy tasks facade only routes into this module.
 */
export function applyAtomicScopeAmendment(input) {
    const priorDocument = cloneAuthorityRecord(input.taskDocument);
    const priorLock = cloneAuthorityRecord(input.outerLock);
    const nextDocument = cloneAuthorityRecord(input.taskDocument);
    const nextLock = cloneAuthorityRecord(input.outerLock);
    const nextEmbedded = (nextLock.taskDirectionLock && typeof nextLock.taskDirectionLock === 'object' && !Array.isArray(nextLock.taskDirectionLock)
        ? nextLock.taskDirectionLock
        : cloneAuthorityRecord(input.embeddedLockRecord));
    let lockWritten = false;
    try {
        syncScopeAmendmentState({
            taskDocument: nextDocument,
            outerLock: nextLock,
            embeddedLockRecord: nextEmbedded,
            mergedAllowed: input.mergedAllowed
        });
        input.ports.resealTicket(nextDocument);
        const ticket = (nextDocument.workAdmissionTicket ?? null);
        assertTicketCoversAmendedScope({
            ticket,
            mergedAllowed: input.mergedAllowed,
            taskId: input.taskId,
            actorId: input.actorId
        });
        input.ports.writeLock(nextLock);
        lockWritten = true;
        input.ports.persistLedger(nextDocument);
        replaceRecord(input.taskDocument, nextDocument);
        replaceRecord(input.outerLock, nextLock);
        return {
            taskDocument: nextDocument,
            outerLock: nextLock,
            ticket,
            mergedAllowed: input.mergedAllowed
        };
    }
    catch (error) {
        replaceRecord(input.taskDocument, priorDocument);
        replaceRecord(input.outerLock, priorLock);
        if (lockWritten) {
            try {
                input.ports.writeLock(priorLock);
            }
            catch {
                // Restore is best-effort; the original error remains the command result.
            }
        }
        throw error;
    }
}
