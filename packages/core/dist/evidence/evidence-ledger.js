import { createHash } from 'node:crypto';
export const EVIDENCE_LEDGER_ENTRY_SCHEMA_ID = 'atm.evidenceLedgerEntry.v1';
export const EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID = 'atm.evidenceLedgerCheckpoint.v1';
export const EVIDENCE_STORAGE_POLICY = {
    runtimeRoot: '.atm/runtime/evidence-ledger',
    legacyRoot: '.atm/history/evidence',
    durableKinds: [
        'abandon-residue-disposition',
        'bundle-manifest',
        'checkpoint',
        'closure-packet',
        'index-restore-failure',
        'live-index-reconciliation',
        'proposal-lane',
        'runner-publication-recovery',
        'runner-sync-receipt',
        'seal-and-commit'
    ]
};
export function runtimeEvidenceBundleRelativePath(workItemId) {
    return `${EVIDENCE_STORAGE_POLICY.runtimeRoot}/bundles/${workItemId}.json`;
}
export function durableEvidenceRelativePath(workItemId, kind) {
    return `${EVIDENCE_STORAGE_POLICY.legacyRoot}/${workItemId}.${kind}.json`;
}
export function legacyEvidenceBundleRelativePath(workItemId) {
    return `${EVIDENCE_STORAGE_POLICY.legacyRoot}/${workItemId}.json`;
}
export function isDurableEvidencePath(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return EVIDENCE_STORAGE_POLICY.durableKinds.some((kind) => normalized.startsWith(`${EVIDENCE_STORAGE_POLICY.legacyRoot}/`)
        && normalized.endsWith(`.${kind}.json`));
}
function canonicalize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}
export function sha256(value) {
    return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}
export function createEvidenceLedgerEntry(workItemId, record) {
    if (!workItemId.trim())
        throw new Error('Evidence Ledger requires a work item id.');
    const digest = sha256({ workItemId, record });
    return { schemaId: EVIDENCE_LEDGER_ENTRY_SCHEMA_ID, digest, workItemId, record };
}
export function verifyEvidenceLedgerEntry(entry) {
    return entry.schemaId === EVIDENCE_LEDGER_ENTRY_SCHEMA_ID
        && entry.digest === sha256({ workItemId: entry.workItemId, record: entry.record });
}
export function createInMemoryEvidenceLedger(entries = []) {
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
