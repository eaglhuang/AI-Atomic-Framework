import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomMetadata, normalizeCssColor, run } from './atom.source.mjs';

const atomRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(atomRoot, '../../..');
const reportPath = path.join(atomRoot, 'atom.test.report.json');
const specPath = path.join(repoRoot, 'specs', 'normalize-css-color.atom.json');
const lineageLogPath = path.join(atomRoot, 'lineage-log.json');
const sourcePath = path.join(atomRoot, 'atom.source.mjs');

const fixtures = {
  positive: [
    'fixtures/positive/hex-3.json',
    'fixtures/positive/hex-4.json',
    'fixtures/positive/hex-6.json',
    'fixtures/positive/rgb.json',
    'fixtures/positive/rgba.json'
  ],
  negative: [
    'fixtures/negative/transparent.json',
    'fixtures/negative/named-color.json'
  ],
  legacy: 'fixtures/legacy/draft-builder-shadow.json'
};

const caseResults = [];
const startedAt = Date.now();
const lineageLog = JSON.parse(readFileSync(lineageLogPath, 'utf8'));

function loadFixture(relativePath) {
  return JSON.parse(readFileSync(path.join(atomRoot, relativePath), 'utf8'));
}

function sha256ForFile(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function sha256ForFiles(filePaths) {
  const hash = createHash('sha256');
  for (const filePath of filePaths) {
    hash.update(readFileSync(filePath));
  }
  return `sha256:${hash.digest('hex')}`;
}

function runPositiveFixture(relativePath) {
  const fixture = loadFixture(relativePath);
  const direct = normalizeCssColor(fixture.input);
  const atomRun = run({ color: fixture.input });

  assert.equal(direct, fixture.expected, `${fixture.name} direct normalize`);
  assert.equal(atomRun.normalizedColor, fixture.expected, `${fixture.name} atom run normalize`);
  assert.equal(atomRun.atomId, atomMetadata.atomId, `${fixture.name} atomId`);
  assert.deepEqual(atomRun.lineage, atomMetadata.lineage, `${fixture.name} lineage`);

  caseResults.push({
    kind: 'positive',
    name: fixture.name,
    input: fixture.input,
    expected: fixture.expected,
    actual: atomRun.normalizedColor,
    ok: true
  });
}

function runNegativeFixture(relativePath) {
  const fixture = loadFixture(relativePath);
  const direct = normalizeCssColor(fixture.input);
  const atomRun = run({ color: fixture.input });

  assert.equal(direct, fixture.expected, `${fixture.name} direct normalize`);
  assert.equal(atomRun.normalizedColor, fixture.expected, `${fixture.name} atom run normalize`);
  assert.equal(atomRun.atomId, atomMetadata.atomId, `${fixture.name} atomId`);
  assert.deepEqual(atomRun.lineage, atomMetadata.lineage, `${fixture.name} lineage`);

  caseResults.push({
    kind: 'negative',
    name: fixture.name,
    input: fixture.input,
    expected: fixture.expected,
    actual: atomRun.normalizedColor,
    ok: true
  });
}

function runLegacyFixture(relativePath) {
  const fixture = loadFixture(relativePath);
  const atomRun = run({ color: fixture.input });

  assert.equal(lineageLog.bornBy, atomMetadata.lineage.bornBy, 'lineage log bornBy');
  assert.deepEqual(lineageLog.parentRefs, atomMetadata.lineage.parentRefs, 'lineage log parentRefs');
  assert.equal(fixture.legacySource, atomMetadata.lineage.parentRefs[0], 'legacy source lineage');
  assert.equal(atomRun.normalizedColor, fixture.expected, 'legacy normalizedColor');
  assert.equal(atomRun.atomId, atomMetadata.atomId, 'legacy atomId');
  assert.deepEqual(atomRun.lineage, atomMetadata.lineage, 'legacy lineage');

  caseResults.push({
    kind: 'legacy',
    name: fixture.name,
    input: fixture.input,
    expected: fixture.expected,
    actual: atomRun.normalizedColor,
    legacySource: fixture.legacySource,
    ok: true
  });
}

for (const fixturePath of fixtures.positive) {
  runPositiveFixture(fixturePath);
}

for (const fixturePath of fixtures.negative) {
  runNegativeFixture(fixturePath);
}

runLegacyFixture(fixtures.legacy);

const durationMs = Date.now() - startedAt;
const specHash = sha256ForFile(specPath);
const codeHash = sha256ForFiles([sourcePath]);
const testHash = sha256ForFiles([path.join(atomRoot, 'atom.test.mjs')]);
const report = {
  schemaId: 'atm.testReport',
  specVersion: '0.1.0',
  migration: {
    strategy: 'none',
    fromVersion: null,
    notes: 'First html-to-ucuf normalizeCssColor atom test report.'
  },
  atomId: atomMetadata.atomId,
  ok: true,
  exitCode: 0,
  generatedAt: new Date().toISOString(),
  repositoryRoot: repoRoot.replace(/\\/g, '/'),
  specPath: specPath.replace(/\\/g, '/'),
  hashLock: {
    algorithm: 'sha256',
    digest: specHash,
    canonicalization: 'json-stable-v1'
  },
  validation: {
    evidenceRequired: true,
    commandCount: 1
  },
  runnerContract: {
    executionMode: 'delegated',
    evidenceRequired: true,
    commands: [
      {
        commandId: 'validation-1',
        commandKind: 'test',
        command: 'node atomic_workbench/atoms/ATM-CORE-0005/atom.test.mjs',
        required: true
      }
    ]
  },
  cases: caseResults,
  summary: {
    total: caseResults.length,
    passed: caseResults.length,
    failed: 0,
    durationMs
  },
  selfVerification: {
    legacyPlanningId: 'ATM-CORE-0005',
    specHash,
    codeHash,
    testHash,
    sourcePaths: {
      spec: specPath.replace(/\\/g, '/'),
      code: [sourcePath.replace(/\\/g, '/')],
      tests: [path.join(atomRoot, 'atom.test.mjs').replace(/\\/g, '/')]
    }
  },
  artifacts: [
    {
      artifactPath: reportPath.replace(/\\/g, '/'),
      artifactKind: 'report',
      producedBy: '@ai-atomic-framework/core:test-runner'
    },
    {
      artifactPath: specPath.replace(/\\/g, '/'),
      artifactKind: 'file',
      producedBy: '@ai-atomic-framework/core:test-runner'
    },
    {
      artifactPath: lineageLogPath.replace(/\\/g, '/'),
      artifactKind: 'file',
      producedBy: '@ai-atomic-framework/core:test-runner'
    }
  ],
  evidence: [
    {
      evidenceKind: 'validation',
      summary: `Atomic test runner verified ${atomMetadata.atomId} with ${caseResults.length}/${caseResults.length} fixture cases passing.`,
      artifactPaths: [
        reportPath.replace(/\\/g, '/'),
        specPath.replace(/\\/g, '/'),
        lineageLogPath.replace(/\\/g, '/')
      ]
    }
  ]
};

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`[${atomMetadata.atomId}] atom tests passed -> ${reportPath}`);