import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomMetadata, parseFragmentList, run } from './atom.source.mjs';

const atomRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(atomRoot, '../../..');
const reportPath = path.join(atomRoot, 'atom.test.report.json');
const specPath = path.join(repoRoot, 'specs', 'parse-fragment-list.atom.json');
const lineageLogPath = path.join(atomRoot, 'lineage-log.json');
const sourcePath = path.join(atomRoot, 'atom.source.mjs');

const fixtures = {
  positive: [
    'fixtures/positive/basic-list.json',
    'fixtures/positive/spaces-and-empty.json',
    'fixtures/positive/single-fragment.json'
  ],
  negative: [
    'fixtures/negative/empty-string.json',
    'fixtures/negative/null-input.json'
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

function runFixture(relativePath, kind) {
  const fixture = loadFixture(relativePath);
  const direct = parseFragmentList(fixture.input);
  const atomRun = run({ fragments: fixture.input });

  assert.deepEqual(direct, fixture.expected, `${fixture.name} direct parse`);
  assert.deepEqual(atomRun.fragmentList, fixture.expected, `${fixture.name} atom run parse`);
  assert.equal(atomRun.atomId, atomMetadata.atomId, `${fixture.name} atomId`);
  assert.deepEqual(atomRun.lineage, atomMetadata.lineage, `${fixture.name} lineage`);

  caseResults.push({
    kind,
    name: fixture.name,
    input: fixture.input,
    expected: fixture.expected,
    actual: atomRun.fragmentList,
    ok: true
  });
}

function runLegacyFixture(relativePath) {
  const fixture = loadFixture(relativePath);
  const atomRun = run({ fragments: fixture.input });

  assert.equal(lineageLog.bornBy, atomMetadata.lineage.bornBy, 'lineage log bornBy');
  assert.deepEqual(lineageLog.parentRefs, atomMetadata.lineage.parentRefs, 'lineage log parentRefs');
  assert.equal(fixture.legacySource, atomMetadata.lineage.parentRefs[0], 'legacy source lineage');
  assert.deepEqual(atomRun.fragmentList, fixture.expected, 'legacy fragmentList');

  caseResults.push({
    kind: 'legacy',
    name: fixture.name,
    input: fixture.input,
    expected: fixture.expected,
    actual: atomRun.fragmentList,
    legacySource: fixture.legacySource,
    ok: true
  });
}

for (const fixturePath of fixtures.positive) {
  runFixture(fixturePath, 'positive');
}
for (const fixturePath of fixtures.negative) {
  runFixture(fixturePath, 'negative');
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
    notes: 'parseFragmentList atom test report.'
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
        command: 'node atomic_workbench/atoms/ATM-CORE-0007/atom.test.mjs',
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
    legacyPlanningId: 'ATM-CORE-0007',
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
