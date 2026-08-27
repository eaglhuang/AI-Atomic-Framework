import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLocalGovernanceStores } from '../../packages/plugin-governance-local/src/stores.ts';
import { migrateEvidenceLedger } from '../../scripts/migrate-evidence-ledger.ts';
import { validateEvidenceLedgerBoundary } from '../../scripts/validate-evidence-ledger-boundary.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-ledger-'));

try {
  const stores = createLocalGovernanceStores({ repositoryRoot: root });
  const input = { evidenceKind: 'validation' as const, summary: 'ledger round trip', artifactPaths: [], producedBy: 'fixture' };
  const entry = await stores.evidenceStore.appendEvidence('TASK-PRF-0005', input);
  assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual((await stores.evidenceStore.resolveEvidence(entry.digest))?.record, input);
  assert.equal(await stores.evidenceStore.verifyEvidence(entry.digest), true);
  assert.deepEqual(await stores.evidenceStore.listEvidence('TASK-PRF-0005'), [input]);
  const checkpoint = await stores.evidenceStore.checkpointEvidence();
  assert.deepEqual(checkpoint.entryDigests, [entry.digest]);
  assert.match(checkpoint.digest, /^sha256:[a-f0-9]{64}$/);
  const legacyRoot = path.join(root, '.atm', 'history', 'evidence');
  mkdirSync(legacyRoot, { recursive: true });
  const legacyRecord = { evidenceKind: 'validation' as const, summary: 'legacy restore drill', artifactPaths: [], producedBy: 'fixture' };
  writeFileSync(path.join(legacyRoot, 'TASK-LEGACY-0001.json'), `${JSON.stringify({ taskId: 'TASK-LEGACY-0001', evidence: [legacyRecord] })}\n`, 'utf8');
  const manifest = migrateEvidenceLedger({ repositoryRoot: root, writeManifest: true });
  assert.equal(manifest.records.length, 1);
  assert.equal(manifest.records[0].legacyRecordDigest, manifest.records[0].ledgerDigest);
  assert.deepEqual(
    validateEvidenceLedgerBoundary(root, 'docs/reports/evidence-ledger-migration-manifest.json', process.cwd()),
    { ok: true, records: 1, checkpointDigest: manifest.checkpointDigest }
  );
  console.log('[evidence-ledger-migration] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
