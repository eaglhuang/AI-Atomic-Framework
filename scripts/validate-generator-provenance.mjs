import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRegistryEntryDrift, validateRegistryDocumentFile } from '../packages/core/src/registry/registry.mjs';

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
  'generator-provenance:backfilled'
]);

let failed = false;
function fail(message) {
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
  fail('generator provenance audit report is missing; run node scripts/validate-generator-provenance.mjs --write');
} else {
  const currentReportText = readFileSync(reportPath, 'utf8');
  if (currentReportText !== reportText) {
    fail('generator provenance audit report is stale; run node scripts/validate-generator-provenance.mjs --write');
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

console.log(`[generator-provenance:${mode}] ok (${report.summary.total} entries audited, ${report.summary.generated} generated, ${report.summary.backfilled} backfilled)`);

function buildAuditReport(registryDocument) {
  const entries = registryDocument.entries.map((entry) => auditEntry(entry));
  return {
    schemaId: 'atm.generatorProvenanceAudit',
    specVersion: '0.1.0',
    registryId: registryDocument.registryId,
    registryGeneratedAt: registryDocument.generatedAt,
    summary: {
      total: entries.length,
      generated: entries.filter((entry) => entry.provenance === 'generated').length,
      backfilled: entries.filter((entry) => entry.provenance === 'backfilled').length,
      bootstrapSelf: entries.filter((entry) => entry.provenance === 'bootstrap-self').length,
      unmarked: entries.filter((entry) => entry.provenance === 'unmarked').length
    },
    entries
  };
}

function auditEntry(entry) {
  const marker = findProvenanceMarker(entry);
  const provenance = marker ? marker.slice('generator-provenance:'.length) : 'unmarked';
  const issues = [];
  if (!marker) {
    issues.push('missing-generator-provenance-marker');
  } else if (!allowedMarkers.has(marker)) {
    issues.push(`unknown-generator-provenance-marker:${marker}`);
  }

  const location = entry.location ?? {};
  const workbenchPath = normalizePath(location.workbenchPath ?? `atomic_workbench/atoms/${entry.atomId}`);
  const specPath = normalizePath(location.specPath ?? entry.specPath);
  const codePaths = Array.isArray(location.codePaths) ? location.codePaths.map(normalizePath) : [];
  const testPaths = Array.isArray(location.testPaths) ? location.testPaths.map(normalizePath) : [];

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

  if (provenance === 'generated') {
    if (codePaths.includes(specPath)) {
      issues.push('generated-code-path-must-not-be-spec-path');
    }
    if (!codePaths.some((codePath) => codePath.endsWith('/atom.source.mjs'))) {
      issues.push('generated-entry-missing-atom-source');
    }
  }

  if (provenance === 'backfilled') {
    for (const expectedFileName of ['atom.spec.json', 'atom.test.ts', 'atom.test.report.json']) {
      const expectedPath = `${workbenchPath}/${expectedFileName}`;
      if (!existsInRepo(expectedPath)) {
        issues.push(`missing-backfilled-workbench-file:${expectedPath}`);
      }
    }
  }

  if (provenance === 'bootstrap-self' && !codePaths.some((codePath) => codePath.endsWith('/atom-generator.mjs'))) {
    issues.push('bootstrap-self-entry-missing-generator-code');
  }

  const drift = evaluateRegistryEntryDrift(entry, { repositoryRoot: root });
  if (!drift.ok) {
    issues.push(`registry-drift:${drift.issues.join('+') || 'unknown'}`);
  }

  return {
    atomId: entry.atomId,
    logicalName: entry.logicalName ?? null,
    provenance,
    marker,
    workbenchPath,
    specPath,
    codePaths,
    testPaths,
    driftOk: drift.ok,
    issues
  };
}

function findProvenanceMarker(entry) {
  return (entry.evidence ?? []).find((value) => typeof value === 'string' && value.startsWith('generator-provenance:')) ?? null;
}

function existsInRepo(relativePath) {
  return relativePath && existsSync(path.join(root, relativePath));
}

function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}