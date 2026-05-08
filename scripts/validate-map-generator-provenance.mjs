import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistryDocumentFile } from '../packages/core/src/registry/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const writeReport = process.argv.includes('--write');
const registryPath = path.join(root, 'atomic-registry.json');
const reportPath = path.join(root, 'atomic_workbench', 'map-generator-provenance-audit.json');
const allowedMarkers = new Set([
  'generator-provenance:generated',
  'generator-provenance:backfilled'
]);

let failed = false;
function fail(message) {
  console.error(`[map-generator-provenance:${mode}] ${message}`);
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
  fail('map generator provenance audit report is missing; run node scripts/validate-map-generator-provenance.mjs --write');
} else {
  const currentReportText = readFileSync(reportPath, 'utf8');
  if (currentReportText !== reportText) {
    fail('map generator provenance audit report is stale; run node scripts/validate-map-generator-provenance.mjs --write');
  }
}

for (const entry of report.entries) {
  if (entry.provenanceClass === 'missing-provenance') {
    fail(`${entry.mapId} missing provenance marker (${entry.followUp.action})`);
  }
  if (entry.issues.length > 0) {
    fail(`${entry.mapId} provenance issues: ${entry.issues.join(', ')}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`[map-generator-provenance:${mode}] ok (${report.summary.total} entries audited, ${report.summary.generatorBorn} generator-born, ${report.summary.backfilledLegacy} backfilled-legacy, ${report.summary.missingProvenance} missing provenance)`);

function buildAuditReport(registryDocument) {
  const entries = (Array.isArray(registryDocument.entries) ? registryDocument.entries : [])
    .filter((entry) => entry?.schemaId === 'atm.atomicMap')
    .map((entry) => auditMapEntry(entry));

  return {
    schemaId: 'atm.mapGeneratorProvenanceAudit',
    specVersion: '0.1.0',
    registryId: registryDocument.registryId,
    registryGeneratedAt: registryDocument.generatedAt,
    summary: {
      total: entries.length,
      generatorBorn: entries.filter((entry) => entry.provenanceClass === 'generator-born').length,
      backfilledLegacy: entries.filter((entry) => entry.provenanceClass === 'backfilled-legacy').length,
      missingProvenance: entries.filter((entry) => entry.provenanceClass === 'missing-provenance').length
    },
    entries
  };
}

function auditMapEntry(entry) {
  const marker = findProvenanceMarker(entry);
  const provenanceClass = marker === 'generator-provenance:generated'
    ? 'generator-born'
    : marker === 'generator-provenance:backfilled'
      ? 'backfilled-legacy'
      : 'missing-provenance';
  const workbenchPath = normalizePath(entry.location?.workbenchPath ?? `atomic_workbench/maps/${entry.mapId}`);
  const specPath = normalizePath(entry.location?.specPath ?? `${workbenchPath}/map.spec.json`);
  const testPaths = Array.isArray(entry.location?.testPaths) && entry.location.testPaths.length > 0
    ? entry.location.testPaths.map(normalizePath)
    : [`${workbenchPath}/map.integration.test.mjs`];
  const reportPathValue = normalizePath(entry.location?.reportPath ?? `${workbenchPath}/map.test.report.json`);
  const issues = [];

  if (marker && !allowedMarkers.has(marker)) {
    issues.push(`unknown-generator-provenance-marker:${marker}`);
  }
  if (!entry.location) {
    issues.push('missing-location-block');
  }
  if (!existsInRepo(workbenchPath)) {
    issues.push('missing-workbench-path');
  }
  if (!existsInRepo(specPath)) {
    issues.push('missing-spec-path');
  }
  if (!existsInRepo(reportPathValue)) {
    issues.push('missing-report-path');
  }
  for (const testPath of testPaths) {
    if (!existsInRepo(testPath)) {
      issues.push(`missing-test-path:${testPath}`);
    }
  }
  if (!testPaths.some((testPath) => testPath.endsWith('/map.integration.test.mjs'))) {
    issues.push('missing-canonical-map-test');
  }

  if (provenanceClass === 'backfilled-legacy') {
    if (typeof entry.lineageLogRef !== 'string' || entry.lineageLogRef.trim().length === 0) {
      issues.push('backfilled-entry-missing-lineage-log');
    } else if (!existsInRepo(normalizePath(entry.lineageLogRef))) {
      issues.push(`missing-lineage-log:${normalizePath(entry.lineageLogRef)}`);
    }
  }

  const drift = evaluateMapEntryDrift(entry, { specPath });
  if (!drift.ok) {
    issues.push(`registry-drift:${drift.issues.join('+') || 'unknown'}`);
  }

  return {
    mapId: String(entry.mapId || '').trim(),
    provenanceClass,
    marker: marker ?? null,
    workbenchPath,
    specPath,
    testPaths,
    reportPath: reportPathValue,
    lineageLogRef: typeof entry.lineageLogRef === 'string' ? entry.lineageLogRef : null,
    driftOk: drift.ok,
    issues,
    followUp: provenanceClass === 'missing-provenance'
      ? {
          action: 'open-follow-up',
          reason: 'map entry lacks explicit generator-provenance evidence',
          suggestedTaskId: 'ATM-2-0045'
        }
      : null
  };
}

function findProvenanceMarker(entry) {
  return (entry?.evidence ?? []).find((value) => typeof value === 'string' && value.startsWith('generator-provenance:')) ?? null;
}

function evaluateMapEntryDrift(entry, options = {}) {
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
  const issues = [];
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      issues.push(key);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function normalizeMapComparable(value) {
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
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    mapHash: String(value?.mapHash || '').trim(),
    semanticFingerprint: String(value?.semanticFingerprint || '').trim(),
    lineageLogRef: String(value?.lineageLogRef || '').trim(),
    ttl: typeof value?.ttl === 'number' ? value.ttl : null
  };
}

function existsInRepo(relativePath) {
  return relativePath && existsSync(path.join(root, relativePath));
}

function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}
