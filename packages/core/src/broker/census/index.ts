import { createHash } from 'node:crypto';

export type CensusObservationStatus = 'observed' | 'unavailable';
export type CensusTerminalStatus = 'open' | 'done' | 'blocked' | 'abandoned' | 'unknown';
export type CensusDisposition = 'Fixed' | 'Open' | 'inconclusive';

export interface SharedWriteCensusEntry {
  readonly id: string;
  readonly kind:
    | 'canonical-ticket'
    | 'bcr'
    | 'queue'
    | 'freeze'
    | 'direction-lock'
    | 'claim'
    | 'scope-amendment'
    | 'runner-sync-reservation'
    | 'task-terminal-state'
    | 'closeback'
    | 'backlog-item'
    | 'closure-packet';
  readonly authority: string;
  readonly generation: string | null;
  readonly digest: string;
  readonly terminalStatus: CensusTerminalStatus;
  readonly recoveryCommand: string;
  readonly observationStatus: CensusObservationStatus;
  readonly evidenceRef: string;
  readonly ownerCard: string;
}

export interface CurrentSourceDiscriminationProbe {
  readonly backlogId: string;
  readonly probeCommand: string;
  readonly frozenResult: CensusDisposition;
  readonly sourceResult: CensusDisposition;
  readonly ownerCard: string;
  readonly evidenceRef: string;
}

export interface SharedWriteGateCoverage {
  readonly schemaId: 'atm.sharedWriteGateCoverage.v1';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly entries: readonly SharedWriteCensusEntry[];
  readonly currentSourceDiscrimination: readonly CurrentSourceDiscriminationProbe[];
  readonly projectionOnlyItemCount: number;
  readonly unknownOwnerCount: number;
  readonly unavailableReceipts: readonly SharedWriteCensusEntry[];
  readonly digest: string;
}

export interface SharedWriteGateCoverageInput {
  readonly generatedAt?: string;
  readonly entries: readonly Omit<SharedWriteCensusEntry, 'digest'>[];
  readonly currentSourceDiscrimination?: readonly CurrentSourceDiscriminationProbe[];
  readonly projectionOnlyItemCount?: number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function buildSharedWriteGateCoverage(input: SharedWriteGateCoverageInput): SharedWriteGateCoverage {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const entries = input.entries.map((entry) => ({
    ...entry,
    digest: sha256Digest(entry)
  }));
  const unknownOwnerCount = entries.filter((entry) => entry.ownerCard === 'unknown' || entry.authority === 'unknown').length;
  const unavailableReceipts = entries.filter((entry) => entry.observationStatus === 'unavailable');
  const withoutDigest = {
    schemaId: 'atm.sharedWriteGateCoverage.v1' as const,
    specVersion: '0.1.0' as const,
    generatedAt,
    entries,
    currentSourceDiscrimination: input.currentSourceDiscrimination ?? [],
    projectionOnlyItemCount: input.projectionOnlyItemCount ?? 0,
    unknownOwnerCount,
    unavailableReceipts
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

