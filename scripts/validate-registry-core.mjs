import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.mjs';
import { runAtomicTestRunner } from '../packages/core/src/manager/test-runner.mjs';
import { createAtomicMapRegistryEntry, validateAtomicMapRegistryEntryHash } from '../packages/core/src/registry/map-registry.ts';
import { createAtomicRegistryEntry, createRegistryDocument, evaluateRegistryEntryDrift, validateRegistryDocument } from '../packages/core/src/registry/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/registry.fixture.json');
const mapFixtures = {
  minimal: readJson('fixtures/registry/map/minimal.json'),
  multiEdge: readJson('fixtures/registry/map/multi-edge.json')
};
const mapAcceptance = [
  'atomic map hash matches the canonical sorted payload for minimal maps',
  'atomic map hash changes when any member version changes',
  'registry document accepts atom entries and map entries together',
  'multi-edge atomic maps validate as registry entries'
];

function fail(message) {
  console.error(`[registry-core:${mode}] ${message}`);
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

function collectDeclaredWorkbenchFolders(registryDocument) {
  const folders = new Set();
  for (const entry of Array.isArray(registryDocument?.entries) ? registryDocument.entries : []) {
    const workbenchPath = String(entry?.location?.workbenchPath || '').trim().replace(/\\/g, '/');
    if (!workbenchPath.startsWith('atomic_workbench/atoms/')) {
      continue;
    }
    const folderName = workbenchPath.slice('atomic_workbench/atoms/'.length);
    if (folderName && !folderName.includes('/')) {
      folders.add(folderName);
    }
  }
  return folders;
}

function assertNoWorkbenchAliasDrift(repositoryRoot, registryDocument, label) {
  const workbenchRoot = path.join(repositoryRoot, 'atomic_workbench', 'atoms');
  if (!existsSync(workbenchRoot)) {
    return;
  }
  const declaredFolders = collectDeclaredWorkbenchFolders(registryDocument);
  const strayFolders = readdirSync(workbenchRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((folderName) => !declaredFolders.has(folderName));
  check(strayFolders.length === 0, `${label} contains stray workbench directories not declared by registry workbenchPath: ${strayFolders.join(', ')}`);
}

function stageFixtureFiles(tempRoot) {
  for (const relativePath of [fixture.specPath, fixture.codePath, fixture.testPath]) {
    const sourcePath = path.join(root, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function mutateFile(tempRoot, relativePath, transform) {
  const filePath = path.join(tempRoot, relativePath);
  const original = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, transform(original), 'utf8');
  return () => writeFileSync(filePath, original, 'utf8');
}

function assertProtectedFilesStayNeutral() {
  const protectedFiles = [
    'packages/core/src/hash-lock/hash-lock.mjs',
    'packages/core/src/registry/registry.mjs',
    'scripts/validate-registry-core.mjs',
    'tests/registry.fixture.json',
    fixture.specPath,
    fixture.codePath,
    fixture.testPath
  ];
  const bannedTerms = [
    ['3K', 'Life'].join(''),
    ['Co', 'cos'].join(''),
    ['co', 'cos', '-creator'].join(''),
    ['html', '-to-', 'u', 'cuf'].join(''),
    ['ga', 'cha'].join(''),
    ['UC', 'UF'].join(''),
    ['task', '-lock'].join(''),
    ['compute', '-gate'].join(''),
    ['doc', '-id-', 'registry'].join('')
  ];
  for (const relativePath of protectedFiles) {
    const content = readFileSync(path.join(root, relativePath), 'utf8').toLowerCase();
    for (const term of bannedTerms) {
      check(!content.includes(term.toLowerCase()), `${relativePath} contains forbidden hard-coded term: ${term}`);
    }
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-core-'));
try {
  stageFixtureFiles(tempRoot);

  const parsed = parseAtomicSpecFile(fixture.specPath, { cwd: tempRoot });
  check(parsed.ok === true, 'registry fixture spec must parse before building registry entry');

  const testRun = runAtomicTestRunner(parsed.normalizedModel, {
    repositoryRoot: tempRoot,
    now: fixture.generatedAt
  });
  check(testRun.ok === true, 'registry fixture test runner must succeed before registry build');

  const entry = createAtomicRegistryEntry(parsed.normalizedModel, {
    repositoryRoot: tempRoot,
    atomVersion: fixture.expectedAtomVersion,
    status: fixture.expectedStatus,
    owner: fixture.owner,
    codePaths: [fixture.codePath],
    testPaths: [fixture.testPath],
    testReport: testRun.report
  });
  check(entry.id === fixture.expectedId, 'registry entry id must default to atom id');
  check(entry.atomVersion === fixture.expectedAtomVersion, 'registry entry must record atom version');
  check(entry.status === fixture.expectedStatus, 'registry entry must preserve registry status');
  check(entry.location?.specPath === fixture.specPath, 'registry entry must record spec location');
  check(entry.location?.codePaths[0] === fixture.codePath, 'registry entry must record code location');
  check(entry.location?.testPaths[0] === fixture.testPath, 'registry entry must record test location');
  check(entry.location?.workbenchPath === fixture.expectedWorkbenchPath, 'registry entry must derive workbench location from report path');
  check(path.basename(entry.location?.workbenchPath ?? '') === fixture.expectedId, 'registry workbench folder name must equal the Atomic ID exactly');
  check(entry.evidence.includes(fixture.expectedReportPath), 'registry entry evidence must include machine-readable test report');

  const document = createRegistryDocument([entry], {
    registryId: fixture.expectedRegistryId,
    generatedAt: fixture.generatedAt,
    sharding: fixture.sharding
  });
  check(document.registryId === fixture.expectedRegistryId, 'registry document id mismatch');
  check(document.sharding?.strategy === fixture.sharding.strategy, 'registry document must preserve sharding strategy');
  check(document.sharding?.partPaths[0] === fixture.sharding.partPaths[0], 'registry document must preserve shard path metadata');
  check(validateRegistryDocument(document).ok === true, 'registry document must validate against JSON Schema');
  assertNoWorkbenchAliasDrift(tempRoot, document, 'fixture atomic_workbench/atoms');

  const baseline = evaluateRegistryEntryDrift(entry, { repositoryRoot: tempRoot });
  check(baseline.ok === true, 'baseline registry entry must be drift-free');

  let restore = mutateFile(tempRoot, fixture.specPath, (content) => `${content}\n `);
  let drift = evaluateRegistryEntryDrift(entry, { repositoryRoot: tempRoot });
  check(drift.ok === false && drift.issues.includes('specHash'), 'editing spec must trigger specHash drift');
  restore();

  restore = mutateFile(tempRoot, fixture.codePath, (content) => `${content}\nexport const driftProbe = true;\n`);
  drift = evaluateRegistryEntryDrift(entry, { repositoryRoot: tempRoot });
  check(drift.ok === false && drift.issues.includes('codeHash'), 'editing code must trigger codeHash drift');
  restore();

  restore = mutateFile(tempRoot, fixture.testPath, (content) => `${content}\n// drift probe\n`);
  drift = evaluateRegistryEntryDrift(entry, { repositoryRoot: tempRoot });
  check(drift.ok === false && drift.issues.includes('testHash'), 'editing test must trigger testHash drift');
  restore();

  const minimalMapEntry = createAtomicMapRegistryEntry(mapFixtures.minimal);
  check(validateAtomicMapRegistryEntryHash(minimalMapEntry).ok === true, 'minimal atomic map entry must preserve computed mapHash');

  const upgradedMinimalMapEntry = createAtomicMapRegistryEntry({
    ...mapFixtures.minimal,
    members: mapFixtures.minimal.members.map((member, index) => index === 0
      ? { ...member, version: '0.1.1' }
      : member)
  });
  check(upgradedMinimalMapEntry.mapHash !== minimalMapEntry.mapHash, 'upgrading a map member version must change mapHash');

  const multiEdgeMapEntry = createAtomicMapRegistryEntry(mapFixtures.multiEdge);
  check(validateAtomicMapRegistryEntryHash(multiEdgeMapEntry).ok === true, 'multi-edge atomic map entry must preserve computed mapHash');

  const mixedDocument = createRegistryDocument([entry, minimalMapEntry], {
    registryId: `${fixture.expectedRegistryId}.with-map`,
    generatedAt: fixture.generatedAt,
    sharding: fixture.sharding
  });
  check(validateRegistryDocument(mixedDocument).ok === true, 'registry document must allow atom entries and map entries together');

  assertProtectedFilesStayNeutral();

  const currentRegistryDocument = readJson('atomic-registry.json');
  check(validateRegistryDocument(currentRegistryDocument).ok === true, 'current atomic-registry.json must remain valid for alias drift checks');
  assertNoWorkbenchAliasDrift(root, currentRegistryDocument, 'current atomic_workbench/atoms');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[registry-core:${mode}] ok (${fixture.acceptance.length + mapAcceptance.length} acceptance checks)`);
}