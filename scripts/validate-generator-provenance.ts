import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRegistryEntryDrift, validateRegistryDocumentFile } from '../packages/core/src/registry/registry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const writeReport = process.argv.includes('--write');
const registryPath = path.join(root, 'atomic-registry.json');
const reportPath = path.join(root, 'atomic_workbench', 'generator-provenance-audit.json');
const allowedMarkers = new Set([
  'generator-provenance:bootstrap-self',
  'generator-provenance:generated',
  'generator-provenance:backfilled',
  'generator-provenance:atomize'
]);

let failed = false;
function fail(message: any) {
  console.error(`[generator-provenance:${mode}] ${message}`);
  failed = true;
}

const validation = validateRegistryDocumentFile(registryPath);
if (!validation.ok) {
  fail(validation.promptReport?.summary ?? 'registry validation failed');
  process.exit(1);
}

const registryDocument = validation.document;
const report = buildAuditReport(registryDocument);
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (writeReport) {
  writeFileSync(reportPath, reportText, 'utf8');
} else if (!existsSync(reportPath)) {
  fail('generator provenance audit report is missing; run node --experimental-strip-types scripts/validate-generator-provenance.ts --write');
} else {
  const currentReportText = readFileSync(reportPath, 'utf8');
  if (currentReportText !== reportText) {
    fail('generator provenance audit report is stale; run node --experimental-strip-types scripts/validate-generator-provenance.ts --write');
  }
}

for (const entry of report.entries) {
  if (entry.issues.length > 0) {
    fail(`${entry.atomId} provenance issues: ${entry.issues.join(', ')}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`[generator-provenance:${mode}] ok (${report.summary.total} entries audited, ${report.summary.generated} generated, ${report.summary.backfilled} backfilled, ${report.summary.atomized} atomized)`);

function buildAuditReport(registryDocument: any) {
  const entries = registryDocument.entries.map((entry: any) => auditEntry(entry));
  return {
    schemaId: 'atm.generatorProvenanceAudit',
    specVersion: '0.1.0',
    registryId: registryDocument.registryId,
    registryGeneratedAt: registryDocument.generatedAt,
    summary: {
      total: entries.length,
      generated: entries.filter((entry: any) => entry.provenance === 'generated').length,
      backfilled: entries.filter((entry: any) => entry.provenance === 'backfilled').length,
      atomized: entries.filter((entry: any) => entry.provenance === 'atomize').length,
      bootstrapSelf: entries.filter((entry: any) => entry.provenance === 'bootstrap-self').length,
      unmarked: entries.filter((entry: any) => entry.provenance === 'unmarked').length
    },
    entries
  };
}

function auditEntry(entry: any) {
  const entryId = resolveEntryId(entry);
  const isMapEntry = entry?.schemaId === 'atm.atomicMap';
  const marker = findProvenanceMarker(entry);
  const effectiveMarker = marker ?? (isMapEntry ? 'generator-provenance:generated' : null);
  const provenance = effectiveMarker ? effectiveMarker.slice('generator-provenance:'.length) : 'unmarked';
  const issues = [];
  if (!effectiveMarker) {
    issues.push('missing-generator-provenance-marker');
  } else if (!allowedMarkers.has(effectiveMarker)) {
    issues.push(`unknown-generator-provenance-marker:${effectiveMarker}`);
  }

  const location = entry.location ?? {};
  const workbenchPath = normalizePath(location.workbenchPath ?? (isMapEntry
    ? `atomic_workbench/maps/${entry.mapId}`
    : `atomic_workbench/atoms/${entry.atomId}`));
  const specPath = normalizePath(location.specPath ?? entry.specPath ?? (isMapEntry ? `${workbenchPath}/map.spec.json` : ''));
  const codePaths = Array.isArray(location.codePaths)
    ? location.codePaths.map(normalizePath)
    : (isMapEntry ? [] : []);
  const testPaths = Array.isArray(location.testPaths)
    ? location.testPaths.map(normalizePath)
    : (isMapEntry ? [`${workbenchPath}/map.integration.test.ts`] : []);

  if (!existsInRepo(workbenchPath)) {
    issues.push('missing-workbench-path');
  }
  if (!existsInRepo(specPath)) {
    issues.push('missing-spec-path');
  }
  for (const codePath of codePaths) {
    if (!existsInRepo(codePath)) {
      issues.push(`missing-code-path:${codePath}`);
    }
  }
  for (const testPath of testPaths) {
    if (!existsInRepo(testPath)) {
      issues.push(`missing-test-path:${testPath}`);
    }
  }

  if (provenance === 'generated' && !isMapEntry) {
    if (codePaths.includes(specPath)) {
      issues.push('generated-code-path-must-not-be-spec-path');
    }
    if (!codePaths.some((codePath: any) => codePath.endsWith('/atom.source.mjs'))) {
      issues.push('generated-entry-missing-atom-source');
    }
  }

  if (provenance === 'generated' && isMapEntry) {
    if (!testPaths.some((testPath: any) => testPath.endsWith('/map.integration.test.ts'))) {
      issues.push('generated-entry-missing-map-test');
    }
    if (!specPath.endsWith('/map.spec.json')) {
      issues.push('generated-entry-missing-map-spec');
    }
  }

  if (provenance === 'backfilled' && !isMapEntry) {
    for (const expectedFileName of ['atom.spec.json', 'atom.test.ts', 'atom.test.report.json']) {
      const expectedPath = `${workbenchPath}/${expectedFileName}`;
      if (!existsInRepo(expectedPath)) {
        issues.push(`missing-backfilled-workbench-file:${expectedPath}`);
      }
    }
  }

  if (provenance === 'bootstrap-self' && !isMapEntry && !codePaths.some((codePath: any) => codePath.endsWith('/atom-generator.ts'))) {
    issues.push('bootstrap-self-entry-missing-generator-code');
  }

  const drift = isMapEntry
    ? evaluateMapEntryDrift(entry, { specPath })
    : evaluateRegistryEntryDrift(entry, { repositoryRoot: root });
  if (!drift.ok) {
    issues.push(`registry-drift:${drift.issues.join('+') || 'unknown'}`);
  }

  return {
    atomId: entryId,
    logicalName: entry.logicalName ?? null,
    provenance,
    marker: effectiveMarker,
    workbenchPath,
    specPath,
    codePaths,
    testPaths,
    driftOk: drift.ok,
    issues
  };
}

function findProvenanceMarker(entry: any) {
  return (entry.evidence ?? []).find((value: any) => typeof value === 'string' && value.startsWith('generator-provenance:')) ?? null;
}

function resolveEntryId(entry: any) {
  return String(entry?.atomId || entry?.mapId || '').trim();
}

function evaluateMapEntryDrift(entry: any, options: any = {}) {
  const specPath = normalizePath(options.specPath);
  if (!existsInRepo(specPath)) {
    return {
      ok: false,
      issues: ['specPath']
    };
  }

  let specDocument;
  try {
    specDocument = JSON.parse(readFileSync(path.join(root, specPath), 'utf8'));
  } catch {
    return {
      ok: false,
      issues: ['specJson']
    };
  }

  const expected = normalizeMapComparable(entry);
  const actual = normalizeMapComparable(specDocument);
  const issues: string[] = [];
  for (const key of Object.keys(expected) as string[]) {
    if (JSON.stringify((expected as any)[key]) !== JSON.stringify((actual as any)[key])) {
      issues.push(key);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function normalizeMapComparable(value: any) {
  return {
    mapId: String(value?.mapId || '').trim(),
    mapVersion: String(value?.mapVersion || '').trim(),
    members: [...(Array.isArray(value?.members) ? value.members : [])]
      .map((member) => ({
        atomId: String(member.atomId || '').trim(),
        version: String(member.version || '').trim()
      }))
      .sort((left, right) => left.atomId.localeCompare(right.atomId) || left.version.localeCompare(right.version)),
    edges: [...(Array.isArray(value?.edges) ? value.edges : [])]
      .map((edge) => ({
        from: String(edge.from || '').trim(),
        to: String(edge.to || '').trim(),
        binding: String(edge.binding || '').trim()
      }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.binding.localeCompare(right.binding)),
    entrypoints: [...(Array.isArray(value?.entrypoints) ? value.entrypoints : [])]
      .map((entrypoint) => String(entrypoint || '').trim())
      .sort((left, right) => left.localeCompare(right)),
    qualityTargets: Object.fromEntries(
      Object.entries(value?.qualityTargets ?? {})
        .map(([key, item]) => [String(key).trim(), typeof item === 'string' ? item.trim() : item])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    ),
    mapHash: String(value?.mapHash || '').trim(),
    semanticFingerprint: String(value?.semanticFingerprint || '').trim(),
    lineageLogRef: String(value?.lineageLogRef || '').trim(),
    ttl: typeof value?.ttl === 'number' ? value.ttl : null
  };
}

function existsInRepo(relativePath: any) {
  return relativePath && existsSync(path.join(root, relativePath));
}

function normalizePath(value: any) {
  return String(value ?? '').replace(/\\/g, '/');
}
