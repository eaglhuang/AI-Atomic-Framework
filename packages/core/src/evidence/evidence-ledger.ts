import { createHash } from 'node:crypto';

import type { EvidenceRecord } from '../index.ts';

export const EVIDENCE_LEDGER_ENTRY_SCHEMA_ID = 'atm.evidenceLedgerEntry.v1' as const;
export const EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID = 'atm.evidenceLedgerCheckpoint.v1' as const;

export interface EvidenceLedgerEntry {
  readonly schemaId: typeof EVIDENCE_LEDGER_ENTRY_SCHEMA_ID;
  readonly digest: string;
  readonly workItemId: string;
  readonly record: EvidenceRecord;
}

export interface EvidenceLedgerCheckpoint {
  readonly schemaId: typeof EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID;
  readonly digest: string;
  readonly entryDigests: readonly string[];
}

export interface EvidenceLedger {
  append(workItemId: string, record: EvidenceRecord): EvidenceLedgerEntry;
  resolve(digest: string): EvidenceLedgerEntry | null;
  verify(digest: string): boolean;
  checkpoint(): EvidenceLedgerCheckpoint;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

export function createEvidenceLedgerEntry(workItemId: string, record: EvidenceRecord): EvidenceLedgerEntry {
  if (!workItemId.trim()) throw new Error('Evidence Ledger requires a work item id.');
  const digest = sha256({ workItemId, record });
  return { schemaId: EVIDENCE_LEDGER_ENTRY_SCHEMA_ID, digest, workItemId, record };
}

export function verifyEvidenceLedgerEntry(entry: EvidenceLedgerEntry): boolean {
  return entry.schemaId === EVIDENCE_LEDGER_ENTRY_SCHEMA_ID
    && entry.digest === sha256({ workItemId: entry.workItemId, record: entry.record });
}

export function createInMemoryEvidenceLedger(entries: readonly EvidenceLedgerEntry[] = []): EvidenceLedger {
  const records = new Map(entries.map((entry) => [entry.digest, entry]));
  return {
    append(workItemId, record) {
      const entry = createEvidenceLedgerEntry(workItemId, record);
      records.set(entry.digest, entry);
      return entry;
    },
    resolve(digest) {
      return records.get(digest) ?? null;
    },
    verify(digest) {
      const entry = records.get(digest);
      return entry !== undefined && verifyEvidenceLedgerEntry(entry);
    },
    checkpoint() {
      const entryDigests = [...records.keys()].sort();
      return {
        schemaId: EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID,
        entryDigests,
        digest: sha256({ entryDigests })
      };
    }
  };
}
