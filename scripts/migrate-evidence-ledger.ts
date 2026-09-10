import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../packages/core/src/evidence/evidence-ledger.ts';
import type { EvidenceRecord } from '../packages/core/src/index.ts';
import { createLocalGovernanceStores } from '../packages/plugin-governance-local/src/stores.ts';

export const EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID = 'atm.evidenceLedgerMigrationManifest.v1' as const;

export interface EvidenceLedgerMigrationRecord {
  readonly legacyPath: string;
  readonly workItemId: string;
  readonly legacyRecordDigest: string;
  readonly ledgerDigest: string;
  readonly verified: boolean;
}

export interface EvidenceLedgerMigrationManifest {
  readonly schemaId: typeof EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID;
  readonly legacyEvidenceRoot: string;
  readonly ledgerRoot: string;
  readonly records: readonly EvidenceLedgerMigrationRecord[];
  readonly checkpointDigest: string;
  readonly trackedLegacyBaseline: {
    readonly fileCount: number;
    readonly bytes: number;
  };
  readonly futureGitGrowthAvoided: {
    readonly migratedRecordCount: number;
    readonly migratedPayloadBytes: number;
  };
}

export function migrateEvidenceLedger(input: {
  readonly repositoryRoot: string;
  readonly legacyEvidenceRoot?: string;
  readonly manifestPath?: string;
  readonly writeManifest?: boolean;
}): EvidenceLedgerMigrationManifest {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const legacyRoot = path.resolve(input.legacyEvidenceRoot ?? path.join(repositoryRoot, '.atm', 'history', 'evidence'));
  const stores = createLocalGovernanceStores({ repositoryRoot });
  const records: EvidenceLedgerMigrationRecord[] = [];
  const trackedLegacyPaths = readTrackedLegacyPaths(repositoryRoot, legacyRoot);
  let migratedPayloadBytes = 0;

  if (existsSync(legacyRoot)) {
    for (const name of readdirSync(legacyRoot).filter((entry) => entry.endsWith('.json')).sort()) {
      const filePath = path.join(legacyRoot, name);
      for (const parsed of parseJsonDocuments(readFileSync(filePath, 'utf8'))) {
        if (!isRecord(parsed) || !Array.isArray(parsed.evidence)) continue;
        const workItemId = typeof parsed.taskId === 'string' && parsed.taskId.trim()
          ? parsed.taskId.trim()
          : name.replace(/\.json$/, '');
        for (const candidate of parsed.evidence) {
          if (!isEvidenceRecord(candidate)) continue;
          const record = candidate as EvidenceRecord;
          migratedPayloadBytes += Buffer.byteLength(JSON.stringify(record), 'utf8');
          const legacyRecordDigest = sha256({ workItemId, record });
          const entry = stores.evidenceStore.appendEvidence(workItemId, record) as { digest: string };
          records.push({
            legacyPath: path.relative(repositoryRoot, filePath).replace(/\\/g, '/'),
            workItemId,
            legacyRecordDigest,
            ledgerDigest: entry.digest,
            verified: entry.digest === legacyRecordDigest && stores.evidenceStore.verifyEvidence(entry.digest) === true
          });
        }
      }
    }
  }

  const migratedEntryDigests = [...new Set(records.map((record) => record.ledgerDigest))].sort();
  const checkpointDigest = sha256({ entryDigests: migratedEntryDigests });
  const manifest: EvidenceLedgerMigrationManifest = {
    schemaId: EVIDENCE_LEDGER_MIGRATION_MANIFEST_SCHEMA_ID,
    legacyEvidenceRoot: path.relative(repositoryRoot, legacyRoot).replace(/\\/g, '/'),
    ledgerRoot: '.atm/runtime/evidence-ledger',
    records,
    checkpointDigest,
    trackedLegacyBaseline: {
      fileCount: trackedLegacyPaths.length,
      bytes: trackedLegacyPaths.reduce((sum, filePath) => sum + statSync(filePath).size, 0)
    },
    futureGitGrowthAvoided: {
      migratedRecordCount: records.length,
      migratedPayloadBytes
    }
  };
  if (input.writeManifest) {
    const manifestPath = path.resolve(repositoryRoot, input.manifestPath ?? 'docs/reports/evidence-ledger-migration-manifest.json');
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

export function restoreEvidenceLedger(input: {
  readonly sourceRepositoryRoot: string;
  readonly targetRepositoryRoot: string;
  readonly manifest: EvidenceLedgerMigrationManifest;
}) {
  const sourceRoot = path.resolve(input.sourceRepositoryRoot);
  const targetStores = createLocalGovernanceStores({ repositoryRoot: path.resolve(input.targetRepositoryRoot) });
  for (const record of input.manifest.records) {
    const objectPath = path.join(sourceRoot, '.atm', 'runtime', 'evidence-ledger', 'records', `${record.ledgerDigest.replace(/^sha256:/, '')}.json`);
    if (!existsSync(objectPath)) throw new Error(`Evidence Ledger restore object is missing: ${record.ledgerDigest}`);
    const entry = JSON.parse(readFileSync(objectPath, 'utf8')) as { workItemId?: unknown; record?: unknown; digest?: unknown };
    if (entry.digest !== record.ledgerDigest || entry.workItemId !== record.workItemId || !isEvidenceRecord(entry.record)) {
      throw new Error(`Evidence Ledger restore object is corrupt: ${record.ledgerDigest}`);
    }
    const restored = targetStores.evidenceStore.appendEvidence(record.workItemId, entry.record) as { digest: string };
    if (restored.digest !== record.ledgerDigest || targetStores.evidenceStore.verifyEvidence(restored.digest) !== true) {
      throw new Error(`Evidence Ledger restore digest changed: ${record.ledgerDigest}`);
    }
  }
  const checkpoint = targetStores.evidenceStore.checkpointEvidence() as { digest: string };
  if (checkpoint.digest !== input.manifest.checkpointDigest) throw new Error('Evidence Ledger restored checkpoint does not match export.');
  return { restoredRecords: input.manifest.records.length, checkpointDigest: checkpoint.digest };
}

function readTrackedLegacyPaths(repositoryRoot: string, legacyRoot: string): string[] {
  try {
    const relativeRoot = path.relative(repositoryRoot, legacyRoot).replace(/\\/g, '/');
    const output = execFileSync('git', ['ls-files', '-z', '--', relativeRoot], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return output.toString('utf8').split('\0').filter(Boolean).map((entry) => path.join(repositoryRoot, entry));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonDocuments(source: string): unknown[] {
  const documents: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== '}' && char !== ']') continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    documents.push(JSON.parse(source.slice(start, index + 1)));
    start = -1;
  }
  if (depth !== 0 || inString) throw new Error('Legacy evidence contains an incomplete JSON document.');
  return documents;
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  return isRecord(value)
    && typeof value.summary === 'string'
    && Array.isArray(value.artifactPaths)
    && ['validation', 'review', 'metric', 'handoff'].includes(String(value.evidenceKind));
}

function readOption(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && typeof argv[index + 1] === 'string' ? argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const cwd = readOption(process.argv, '--cwd') ?? process.cwd();
  const output = readOption(process.argv, '--output') ?? 'docs/reports/evidence-ledger-migration-manifest.json';
  const write = process.argv.includes('--write');
  const manifest = migrateEvidenceLedger({ repositoryRoot: cwd, manifestPath: output, writeManifest: write });
  console.log(JSON.stringify({ ok: true, mutated: write, manifest }, null, 2));
}
