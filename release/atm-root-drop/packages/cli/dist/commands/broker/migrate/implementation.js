import { authorizeBrokerTicket } from '../../../../../core/dist/broker/ticket-authority/index.js';
import { digestBrokerLifecycleState } from '../../../../../core/dist/broker/lifecycle/index.js';
export function buildLegacyBcrMigrationPlan(input) {
    const entries = input.records.map((record, index) => {
        const id = normalizeToken(record.id) || `legacy-bcr-${index + 1}`;
        const brokerTicket = isRecord(record.brokerTicket) ? record.brokerTicket : null;
        const resourceKeys = normalizeList(record.conflictFiles);
        if (record.legacyAuthorizedTaskIds || record.authorizedFromLegacyField) {
            return {
                id,
                disposition: 'quarantine',
                code: 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH',
                canonicalTicketId: null,
                resourceKeys,
                reason: 'Legacy task-id authorization fields are not converted into canonical broker authority.'
            };
        }
        if (!brokerTicket || brokerTicket.schemaId !== 'atm.brokerTicket.v1' || !normalizeToken(brokerTicket.ticketId)) {
            return {
                id,
                disposition: 'quarantine',
                code: 'ATM_TICKET_ADOPT_REQUIRED',
                canonicalTicketId: null,
                resourceKeys,
                reason: 'No canonical broker ticket is present; migration must adopt or cancel instead of manufacturing a mapping.'
            };
        }
        return {
            id,
            disposition: 'migrate',
            code: null,
            canonicalTicketId: normalizeToken(brokerTicket.ticketId),
            resourceKeys,
            reason: 'Canonical broker ticket is present; legacy paper fields are retained only as evidence.'
        };
    });
    return {
        schemaId: 'atm.legacyBcrMigrationPlan.v1',
        mode: 'dry-run',
        entries,
        migratedCount: entries.filter((entry) => entry.disposition === 'migrate').length,
        quarantinedCount: entries.filter((entry) => entry.disposition === 'quarantine').length,
        legacyAuthorizationUseCount: entries.filter((entry) => entry.code === 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH').length
    };
}
export function applyLegacyBcrMigration(input) {
    const beforeDigest = digestBrokerLifecycleState(input.records);
    const migratedEntries = input.plan.entries.filter((entry) => entry.disposition === 'migrate');
    const quarantinedEntries = input.plan.entries.filter((entry) => entry.disposition === 'quarantine');
    const migratedProjection = {
        canonical: migratedEntries.map((entry) => ({
            id: entry.id,
            brokerTicketId: entry.canonicalTicketId,
            resourceKeys: entry.resourceKeys
        })),
        quarantine: quarantinedEntries.map((entry) => ({
            id: entry.id,
            code: entry.code,
            reason: entry.reason
        }))
    };
    const afterDigest = digestBrokerLifecycleState(migratedProjection);
    return {
        schemaId: 'atm.legacyBcrMigrationReceipt.v1',
        mode: 'apply',
        beforeDigest,
        afterDigest,
        immutableRollbackReceipt: {
            schemaId: 'atm.legacyBcrRollbackReceipt.v1',
            beforeDigest,
            afterDigest,
            migratedEntryIds: migratedEntries.map((entry) => entry.id),
            quarantinedEntryIds: quarantinedEntries.map((entry) => entry.id)
        },
        manualRuntimeEditsRequired: false
    };
}
export function rollbackLegacyBcrMigration(receipt) {
    return {
        schemaId: 'atm.legacyBcrRollbackResult.v1',
        ok: true,
        restoredDigest: receipt.immutableRollbackReceipt.beforeDigest,
        manualRuntimeEditsRequired: false
    };
}
export function assertCanonicalBrokerAuthorizationConsumer(input) {
    const decision = authorizeBrokerTicket(input.brokerTicket, {
        resourceKind: input.resourceKind,
        resourceKey: input.resourceKey,
        operation: input.operation,
        gate: input.gate,
        expectedAuthorityGeneration: input.expectedAuthorityGeneration,
        expectedAuthorityDigest: input.expectedAuthorityDigest
    });
    return {
        ...decision,
        code: decision.authorized
            ? null
            : decision.statusCode === 'resource-dimension-mismatch'
                ? 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH'
                : decision.statusCode
    };
}
function normalizeList(value) {
    return Array.isArray(value)
        ? [...new Set(value.map(normalizeToken).filter(Boolean))].sort()
        : [];
}
function normalizeToken(value) {
    return String(value ?? '').trim().replace(/\\/g, '/');
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
