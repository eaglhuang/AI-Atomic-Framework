import type { MapRegistryEntryRecord, RegistryEntryRecord, RegistryEntryStatus, RegistryGovernanceRecord, RegistryGovernanceTier } from '../index';
import { normalizeRegistryGovernanceTier, resolveRegistryDefaultGovernanceTier, isRegistryEntryStatus } from './status-machine.ts';

export const legacyRegistryStatusMigrationMap: Readonly<Record<string, { readonly status: RegistryEntryStatus; readonly governanceTier: RegistryGovernanceTier }>> = {
  seed: { status: 'active', governanceTier: 'constitutional' },
  active: { status: 'active', governanceTier: 'standard' },
  experimental: { status: 'validated', governanceTier: 'standard' },
  deprecated: { status: 'deprecated', governanceTier: 'standard' },
  governed: { status: 'active', governanceTier: 'governed' }
};

export interface RegistryStatusMigrationInput {
  readonly entryType: 'atom' | 'map';
  readonly status?: string | null;
  readonly governanceTier?: string | null;
}

export interface RegistryStatusMigrationResult {
  readonly status: RegistryEntryStatus;
  readonly governance: RegistryGovernanceRecord;
  readonly legacyStatus: string | null;
}

export function migrateRegistryStatus(input: RegistryStatusMigrationInput): RegistryStatusMigrationResult {
  const rawStatus = String(input.status ?? '').trim();
  const legacyMigration = rawStatus && legacyRegistryStatusMigrationMap[rawStatus];
  const status = legacyMigration?.status ?? (isRegistryEntryStatus(rawStatus) ? rawStatus : (input.entryType === 'map' ? 'draft' : 'active'));
  const governanceTier = normalizeRegistryGovernanceTier(
    input.governanceTier ?? legacyMigration?.governanceTier ?? resolveRegistryDefaultGovernanceTier(status, input.entryType)
  );

  return {
    status,
    governance: {
      tier: governanceTier
    },
    legacyStatus: legacyMigration ? rawStatus : null
  };
}

export function migrateRegistryEntryRecord<T extends RegistryEntryRecord | MapRegistryEntryRecord>(
  entry: T,
  entryType: 'atom' | 'map'
): T & { readonly status: RegistryEntryStatus; readonly governance: RegistryGovernanceRecord } {
  const migrated = migrateRegistryStatus({
    entryType,
    status: (entry as RegistryEntryRecord | MapRegistryEntryRecord).status,
    governanceTier: (entry as RegistryEntryRecord | MapRegistryEntryRecord).governance?.tier ?? null
  });

  return {
    ...entry,
    status: migrated.status,
    governance: migrated.governance
  };
}