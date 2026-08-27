import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createLocalGovernanceStores } from '../packages/plugin-governance-local/src/stores.ts';
import { EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID, type EvidenceLedgerMigrationManifest } from './migrate-evidence-ledger.ts';

const runtimeCallers = [
  'packages/plugin-governance-local/src/stores.ts',
  'packages/plugin-sdk/src/governance/stores.ts',
  'packages/core/src/evidence/evidence-ledger.ts'
] as const;

export function validateEvidenceLedgerBoundary(
  cwd = process.cwd(),
  manifestPath = 'docs/reports/evidence-ledger-migration-manifest.json',
  sourceRoot = cwd
) {
  const repositoryRoot = path.resolve(cwd);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const illegalLegacyReferences = runtimeCallers.filter((relativePath) =>
    readFileSync(path.join(resolvedSourceRoot, relativePath), 'utf8').includes('.atm/history/evidence')
  );
  if (illegalLegacyReferences.length > 0) {
    throw new Error(`Runtime callers retain direct legacy evidence paths: ${illegalLegacyReferences.join(', ')}`);
  }
  const resolvedManifestPath = path.resolve(repositoryRoot, manifestPath);
  if (!existsSync(resolvedManifestPath)) throw new Error(`Evidence Ledger migration manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(resolvedManifestPath, 'utf8')) as EvidenceLedgerMigrationManifest;
  if (manifest.schemaId !== EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID) throw new Error('Evidence Ledger migration manifest schema is invalid.');
  const stores = createLocalGovernanceStores({ repositoryRoot });
  for (const record of manifest.records) {
    if (!record.verified || record.legacyRecordDigest !== record.ledgerDigest || !stores.evidenceStore.verifyEvidence(record.ledgerDigest)) {
      throw new Error(`Evidence Ledger restore verification failed for ${record.legacyPath}.`);
    }
  }
  const checkpoint = stores.evidenceStore.checkpointEvidence() as { digest: string };
  if (checkpoint.digest !== manifest.checkpointDigest) throw new Error('Evidence Ledger checkpoint drifted after migration.');
  return { ok: true, records: manifest.records.length, checkpointDigest: checkpoint.digest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log(JSON.stringify(validateEvidenceLedgerBoundary(), null, 2));
}
