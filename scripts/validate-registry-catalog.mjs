import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.mjs';
import { createMinimalAtomicMapSpec } from '../packages/core/src/manager/map-generator.mjs';
import { runAtomicTestRunner } from '../packages/core/src/manager/test-runner.mjs';
import { createAtomicMapRegistryEntry } from '../packages/core/src/registry/map-registry.ts';
import { createAtomicRegistryEntry, createRegistryDocument, validateRegistryDocumentFile, writeRegistryArtifacts } from '../packages/core/src/registry/registry.mjs';
import { renderRegistryCatalogMarkdown, writeRegistryCatalogFile } from '../packages/core/src/registry/registry-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/registry-catalog.fixture.json');

function fail(message) {
  console.error(`[registry-catalog:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function stageFixtureFiles(tempRoot) {
  for (const relativePath of [fixture.specPath, fixture.codePath, fixture.testPath]) {
    const sourcePath = path.join(root, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }

  for (const mapFixture of fixture.mapFixtures ?? []) {
    const workbenchPath = `atomic_workbench/maps/${mapFixture.mapId}`;
    const specPath = path.join(tempRoot, workbenchPath, 'map.spec.json');
    const lineagePath = mapFixture.lineageLogRef ? path.join(tempRoot, mapFixture.lineageLogRef) : null;
    mkdirSync(path.dirname(specPath), { recursive: true });
    const specDocument = createMinimalAtomicMapSpec({
      mapId: mapFixture.mapId,
      mapVersion: mapFixture.mapVersion,
      members: mapFixture.members,
      edges: mapFixture.edges,
      entrypoints: mapFixture.entrypoints,
      qualityTargets: mapFixture.qualityTargets
    });
    writeFileSync(specPath, `${JSON.stringify(specDocument, null, 2)}\n`, 'utf8');
    if (lineagePath) {
      mkdirSync(path.dirname(lineagePath), { recursive: true });
      writeFileSync(lineagePath, `${JSON.stringify({ mapId: mapFixture.mapId, lineage: true }, null, 2)}\n`, 'utf8');
    }
  }
}

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, '\n');
}

function normalizeComparableMarkdown(value) {
  return normalizeNewlines(value).trimEnd();
}

function assertNoBom(filePath) {
  const content = readFileSync(filePath);
  check(!(content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf), `${path.relative(root, filePath).replace(/\\/g, '/')} must stay UTF-8 without BOM`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-catalog-'));
try {
  stageFixtureFiles(tempRoot);

  const parsed = parseAtomicSpecFile(fixture.specPath, { cwd: tempRoot });
  check(parsed.ok === true, 'registry catalog fixture spec must parse successfully');

  const testRun = runAtomicTestRunner(parsed.normalizedModel, {
    repositoryRoot: tempRoot,
    now: fixture.generatedAt
  });
  check(testRun.ok === true, 'registry catalog fixture test runner must succeed');

  const entry = createAtomicRegistryEntry(parsed.normalizedModel, {
    repositoryRoot: tempRoot,
    atomVersion: fixture.expectedAtomVersion,
    status: fixture.expectedStatus,
    owner: fixture.owner,
    codePaths: [fixture.codePath],
    testPaths: [fixture.testPath],
    testReport: testRun.report
  });
  const mapEntries = (fixture.mapFixtures ?? []).map((mapFixture) => {
    const workbenchPath = `atomic_workbench/maps/${mapFixture.mapId}`;
    const specPath = `${workbenchPath}/map.spec.json`;
    const testPath = `${workbenchPath}/map.integration.test.mjs`;
    const reportPath = `${workbenchPath}/map.test.report.json`;
    const specDocument = createMinimalAtomicMapSpec({
      mapId: mapFixture.mapId,
      mapVersion: mapFixture.mapVersion,
      members: mapFixture.members,
      edges: mapFixture.edges,
      entrypoints: mapFixture.entrypoints,
      qualityTargets: mapFixture.qualityTargets
    });
    return createAtomicMapRegistryEntry(specDocument, {
      status: mapFixture.status,
      governanceTier: 'standard',
      location: {
        specPath,
        codePaths: [],
        testPaths: [testPath],
        reportPath,
        workbenchPath
      },
      evidence: [`generator-provenance:${mapFixture.provenance}`, specPath, testPath, reportPath],
      lineageLogRef: mapFixture.lineageLogRef ?? undefined
    });
  });
  const document = createRegistryDocument([entry, ...mapEntries], {
    registryId: fixture.expectedRegistryId,
    generatedAt: fixture.generatedAt
  });
  const markdown = renderRegistryCatalogMarkdown(document, { repositoryRoot: tempRoot, specRepositoryRoot: tempRoot });
  const snapshot = normalizeComparableMarkdown(readFileSync(path.join(root, fixture.snapshotPath), 'utf8'));
  check(normalizeComparableMarkdown(markdown) === snapshot, 'fixture registry catalog markdown must match snapshot');
  check(markdown.includes('## Atoms'), 'catalog markdown must contain the Atoms section');
  check(markdown.includes('| atomId | logicalName | function | derivedCategory | provenance | status | specPath |'), 'catalog markdown must contain the required atom columns');
  check(markdown.includes('`ATM-FIXTURE-0004`'), 'catalog markdown must include the fixture atom id');
  check(markdown.includes('`atom.registry-fixture`'), 'catalog markdown must include the fixture logicalName');
  check(markdown.includes('`unmarked`'), 'catalog markdown must include the fixture provenance marker');
  check(markdown.includes('`registry / alpha0`'), 'catalog markdown must derive the expected category');
  check(markdown.includes('## Maps'), 'catalog markdown must contain the Maps section');
  check(markdown.includes('| mapId | memberCount | status | workbenchPath | notes |'), 'catalog markdown must contain the required map columns');
  check(markdown.includes('`ATM-MAP-0001`'), 'catalog markdown must include the generated map id');
  check(markdown.includes('`ATM-MAP-0002`'), 'catalog markdown must include the backfilled map id');
  check(markdown.includes('provenance: backfilled'), 'catalog markdown must expose the backfilled provenance note');

  const written = writeRegistryArtifacts(document, {
    repositoryRoot: tempRoot,
    specRepositoryRoot: tempRoot,
    registryPath: 'atomic-registry.json',
    catalogPath: fixture.provingCatalogPath
  });
  check(written.registryPath === 'atomic-registry.json', 'registry artifacts writer must use the default registry path in temp root');
  check(written.catalogPath === fixture.provingCatalogPath, 'registry artifacts writer must support a UTF-8 proving path');
  const provingCatalogPath = path.join(tempRoot, fixture.provingCatalogPath);
  check(existsSync(provingCatalogPath), 'registry artifacts writer must emit the proving catalog file');
  assertNoBom(provingCatalogPath);
  const provingFirst = readFileSync(provingCatalogPath, 'utf8');
  writeRegistryCatalogFile(document, {
    repositoryRoot: tempRoot,
    specRepositoryRoot: tempRoot,
    catalogPath: fixture.provingCatalogPath
  });
  const provingSecond = readFileSync(provingCatalogPath, 'utf8');
  check(normalizeComparableMarkdown(provingFirst) === normalizeComparableMarkdown(provingSecond), 'writing the same catalog twice must be idempotent');

  const currentRegistryValidation = validateRegistryDocumentFile(path.join(root, 'atomic-registry.json'));
  check(currentRegistryValidation.ok === true, 'current atomic-registry.json must remain valid while rendering the catalog');
  const currentCatalog = normalizeComparableMarkdown(readFileSync(path.join(root, fixture.expectedCatalogPath), 'utf8'));
  const currentRendered = renderRegistryCatalogMarkdown(currentRegistryValidation.document, { repositoryRoot: root });
  check(currentCatalog === normalizeComparableMarkdown(currentRendered), 'committed registry catalog must stay in sync with atomic-registry.json');
  assertNoBom(path.join(root, fixture.expectedCatalogPath));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[registry-catalog:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}
