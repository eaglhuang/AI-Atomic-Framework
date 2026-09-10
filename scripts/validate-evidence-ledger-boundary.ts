import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { createLocalGovernanceStores } from '../packages/plugin-governance-local/src/stores.ts';
import { sha256 } from '../packages/core/src/evidence/evidence-ledger.ts';
import { EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID, type EvidenceLedgerMigrationManifest } from './migrate-evidence-ledger.ts';

const productionRoots = [
  'packages/cli/src',
  'packages/core/src',
  'packages/plugin-governance-local/src',
  'packages/plugin-sdk/src'
] as const;

const approvedLegacyReferenceFiles = new Set([
  'packages/core/src/evidence/evidence-ledger.ts',
  'packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts',
  'packages/cli/src/commands/evidence/evidence-store.ts',
  'packages/cli/src/commands/git-head-evidence.ts',
  'packages/cli/src/commands/git-governance/implementation/record-bundle-inspection.ts',
  'packages/cli/src/commands/git-governance/implementation/terminal-history-cleanup.ts',
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'packages/plugin-governance-local/src/layout.ts',
  'packages/plugin-governance-local/src/stores.ts',
  'packages/plugin-sdk/src/governance/layout.ts'
]);

const approvedDurableReferencePatterns = [
  /\.abandon-residue-disposition\.json/,
  /\.bundle-manifest\.json/,
  /\.checkpoint\.json/,
  /\.closure-packet\.json/,
  /\.index-restore-failure\.json/,
  /(?:\.|\/)live-index-reconciliation(?:\.[^/]+)?\.json/,
  /\/git-boundary-runs\/[^/]+\.(?:json|md)/,
  /\/git-head\.jsonl?/,
  /\.proposal-lane-[^/]+\.json/,
  /\.runner-publication-recovery\.json/,
  /\.runner-sync-receipt\.json/,
  /\.seal-and-commit\.json/
] as const;

function listTypeScriptFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(root)) {
    const candidate = path.join(root, entry);
    if (statSync(candidate).isDirectory()) output.push(...listTypeScriptFiles(candidate));
    else if (candidate.endsWith('.ts')
      && !candidate.endsWith('.test.ts')
      && !candidate.endsWith('.spec.ts')
      && !candidate.includes(`${path.sep}__tests__${path.sep}`)) output.push(candidate);
  }
  return output;
}

export function validateProductionEvidenceCallers(sourceRoot = process.cwd()) {
  const absoluteRoot = path.resolve(sourceRoot);
  const files = productionRoots.flatMap((root) => listTypeScriptFiles(path.join(absoluteRoot, root)));
  const illegalReferences: string[] = [];
  for (const absolutePath of files) {
    const relativePath = path.relative(absoluteRoot, absolutePath).replace(/\\/g, '/');
    const source = readFileSync(absolutePath, 'utf8');
    if (!source.includes('.atm/history/evidence')) continue;
    if (approvedLegacyReferenceFiles.has(relativePath)) continue;
    const sourceWithoutDurableReferences = approvedDurableReferencePatterns.reduce(
      (current, pattern) => current.replace(new RegExp(pattern.source, 'g'), ''),
      source
    );
    const hasNakedBundleReference = /history\/evidence\/[A-Za-z0-9_-]+\.json/.test(sourceWithoutDurableReferences)
      || /history\/evidence\/[A-Za-z0-9_.-]*\$\{[^}]+\}\.json/.test(sourceWithoutDurableReferences)
      || /history['"],\s*['"]evidence['"],\s*`\$\{[^}]+\}\.json`/.test(sourceWithoutDurableReferences)
      || /\.atm\/history\/evidence\/<task(?:-id|Id)?>\.json/.test(sourceWithoutDurableReferences);
    if (hasNakedBundleReference) {
      illegalReferences.push(relativePath);
    }
  }
  return { scannedFiles: files.length, illegalReferences: illegalReferences.sort() };
}

export function validateEvidenceLedgerBoundary(
  cwd = process.cwd(),
  manifestPath = 'docs/reports/evidence-ledger-migration-manifest.json',
  sourceRoot = cwd
) {
  const repositoryRoot = path.resolve(cwd);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const callerReport = validateProductionEvidenceCallers(resolvedSourceRoot);
  const illegalLegacyReferences = callerReport.illegalReferences;
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
  const checkpointDigest = sha256({ entryDigests: [...new Set(manifest.records.map((record) => record.ledgerDigest))].sort() });
  if (checkpointDigest !== manifest.checkpointDigest) throw new Error('Evidence Ledger checkpoint drifted after migration.');
  return { ok: true, records: manifest.records.length, checkpointDigest, scannedFiles: callerReport.scannedFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log(JSON.stringify(validateEvidenceLedgerBoundary(), null, 2));
}
