import { authorizeBrokerTicket } from '../../../../../core/src/broker/ticket-authority/index.ts';
import { digestBrokerLifecycleState } from '../../../../../core/src/broker/lifecycle/index.ts';

export interface LegacyBcrMigrationPlanEntry {
  readonly id: string;
  readonly disposition: 'migrate' | 'quarantine';
  readonly code: null | 'ATM_TICKET_ADOPT_REQUIRED' | 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH';
  readonly canonicalTicketId: string | null;
  readonly resourceKeys: readonly string[];
  readonly reason: string;
}

export interface LegacyBcrMigrationPlan {
  readonly schemaId: 'atm.legacyBcrMigrationPlan.v1';
  readonly mode: 'dry-run';
  readonly entries: readonly LegacyBcrMigrationPlanEntry[];
  readonly migratedCount: number;
  readonly quarantinedCount: number;
  readonly legacyAuthorizationUseCount: number;
}

export interface LegacyBcrMigrationReceipt {
  readonly schemaId: 'atm.legacyBcrMigrationReceipt.v1';
  readonly mode: 'apply';
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly immutableRollbackReceipt: {
    readonly schemaId: 'atm.legacyBcrRollbackReceipt.v1';
    readonly beforeDigest: string;
    readonly afterDigest: string;
    readonly migratedEntryIds: readonly string[];
    readonly quarantinedEntryIds: readonly string[];
  };
  readonly manualRuntimeEditsRequired: false;
}

export interface LegacyBcrRollbackResult {
  readonly schemaId: 'atm.legacyBcrRollbackResult.v1';
  readonly ok: boolean;
  readonly restoredDigest: string;
  readonly manualRuntimeEditsRequired: false;
}

export function buildLegacyBcrMigrationPlan(input: {
  readonly records: readonly Record<string, unknown>[];
}): LegacyBcrMigrationPlan {
  const entries = input.records.map((record, index): LegacyBcrMigrationPlanEntry => {
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

export function applyLegacyBcrMigration(input: {
  readonly records: readonly Record<string, unknown>[];
  readonly plan: LegacyBcrMigrationPlan;
}): LegacyBcrMigrationReceipt {
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

export function rollbackLegacyBcrMigration(receipt: LegacyBcrMigrationReceipt): LegacyBcrRollbackResult {
  return {
    schemaId: 'atm.legacyBcrRollbackResult.v1',
    ok: true,
    restoredDigest: receipt.immutableRollbackReceipt.beforeDigest,
    manualRuntimeEditsRequired: false
  };
}

export function assertCanonicalBrokerAuthorizationConsumer(input: {
  readonly brokerTicket: object;
  readonly resourceKind: string;
  readonly resourceKey: string;
  readonly operation: string;
  readonly gate: string;
  readonly expectedAuthorityGeneration?: number;
  readonly expectedAuthorityDigest?: string;
}) {
  const decision = authorizeBrokerTicket(input.brokerTicket as never, {
    resourceKind: input.resourceKind as never,
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

function normalizeList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(normalizeToken).filter(Boolean))].sort()
    : [];
}

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
