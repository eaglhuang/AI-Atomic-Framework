import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceHashSnapshot, normalizeSourcePathList } from '../packages/core/src/hash-lock/hash-lock.ts';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.ts';
import { runAtomicTestRunner } from '../packages/core/src/manager/test-runner.ts';
import { validateRegistryDocument, writeRegistryArtifacts } from '../packages/core/src/registry/registry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'atomic-registry.json');
const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
const backfillTargets = new Set(['ATM-CORE-0001', 'ATM-CORE-0003']);
const markerByAtomId = new Map([
  ['ATM-CORE-0001', 'generator-provenance:backfilled'],
  ['ATM-CORE-0003', 'generator-provenance:backfilled'],
  ['ATM-CORE-0004', 'generator-provenance:bootstrap-self'],
  ['ATM-FIXTURE-0001', 'generator-provenance:generated']
]);

const updatedEntries = registryDocument.entries.map((entry: any) => updateEntry(entry));
const updatedRegistry = {
  ...registryDocument,
  entries: updatedEntries
};

const validation = validateRegistryDocument(updatedRegistry);
if (!validation.ok) {
  console.error(`[backfill-generator-provenance] registry validation failed: ${validation.promptReport.summary}`);
  process.exit(1);
}

const written = writeRegistryArtifacts(updatedRegistry, {
  repositoryRoot: root,
  registryPath: 'atomic-registry.json',
  catalogPath: 'atomic_workbench/registry-catalog.md'
});

console.log(`[backfill-generator-provenance] wrote ${written.registryPath} and ${written.catalogPath}`);

function updateEntry(entry: any) {
  const atomId = entry.atomId;
  const marker = markerByAtomId.get(atomId);
  if (!marker) {
    return entry;
  }

  const sourcePaths = entry.selfVerification?.sourcePaths ?? {};
  const specPath = sourcePaths.spec ?? entry.specPath;
  const codePaths = normalizeSourcePathList(sourcePaths.code ?? entry.location?.codePaths);
  const testPaths = normalizeSourcePathList(sourcePaths.tests ?? entry.location?.testPaths);
  const workbenchPath = entry.location?.workbenchPath ?? `atomic_workbench/atoms/${atomId}`;
  const reportPath = entry.location?.reportPath ?? `${workbenchPath}/atom.test.report.json`;

  if (backfillTargets.has(atomId)) {
    writeWorkbenchMirror(entry, { specPath, workbenchPath });
  }

  const parsed = parseAtomicSpecFile(specPath, { cwd: root });
  if (!parsed.ok) {
    console.error(`[backfill-generator-provenance] spec parse failed for ${atomId}: ${parsed.promptReport.summary}`);
    process.exit(1);
  }

  const testRun = runAtomicTestRunner(parsed.normalizedModel, {
    repositoryRoot: root,
    workbenchPath,
    reportPath,
    now: registryDocument.generatedAt
  });
  if (!testRun.ok) {
    console.error(`[backfill-generator-provenance] validation failed for ${atomId}`);
    process.exit(1);
  }

  const selfVerification = createSourceHashSnapshot({
    repositoryRoot: root,
    specPath,
    codePaths,
    testPaths,
    legacyPlanningId: entry.selfVerification?.legacyPlanningId ?? null
  });

  return {
    ...entry,
    location: {
      specPath: selfVerification.sourcePaths.spec,
      codePaths: [...selfVerification.sourcePaths.code],
      testPaths: [...selfVerification.sourcePaths.tests],
      reportPath,
      workbenchPath
    },
    evidence: uniqueStrings([...(entry.evidence ?? []), marker, reportPath]),
    selfVerification
  };
}

function writeWorkbenchMirror(entry: any, options: any) {
  const workbenchDirectory = path.join(root, options.workbenchPath);
  mkdirSync(workbenchDirectory, { recursive: true });

  const sourceSpecPath = path.join(root, options.specPath);
  const specTargetPath = path.join(workbenchDirectory, 'atom.spec.json');
  const testTargetPath = path.join(workbenchDirectory, 'atom.test.ts');
  writeFileSync(specTargetPath, normalizeTrailingNewline(readFileSync(sourceSpecPath, 'utf8')), 'utf8');
  writeFileSync(testTargetPath, renderBackfillTest(entry, options.specPath), 'utf8');
}

function renderBackfillTest(entry: any, sourceSpecPath: any) {
  return [
    `export const atomId = ${JSON.stringify(entry.atomId)};`,
    `export const logicalName = ${JSON.stringify(entry.logicalName ?? null)};`,
    `export const sourceSpecPath = ${JSON.stringify(sourceSpecPath)};`,
    "export const generatorProvenance = 'generator-provenance:backfilled';",
    '',
    'export function describeBackfill() {',
    '  return { atomId, logicalName, sourceSpecPath, generatorProvenance };',
    '}',
    ''
  ].join('\n');
}

function uniqueStrings(values: any) {
  return [...new Set(values.filter((value: any) => typeof value === 'string' && value.trim().length > 0))];
}

function normalizeTrailingNewline(value: any) {
  return String(value).endsWith('\n') ? String(value) : `${value}\n`;
}