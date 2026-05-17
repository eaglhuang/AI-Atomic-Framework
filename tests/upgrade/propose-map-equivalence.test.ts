import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { proposeAtomicUpgrade } from '../../packages/core/src/upgrade/propose.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-upgrade-map-equivalence-');
const mapId = 'ATM-MAP-0001';
const proposedAt = '2026-01-01T00:00:00.000Z';

try {
  const validate = compileUpgradeProposalValidator();
  const equivalencePath = path.join(tempRoot, 'map-equivalence.pass.json');
  writeJson(equivalencePath, createPassingMapEquivalenceReport(mapId));

  const blockedProposal = proposeAtomicUpgrade({
    atomId: 'ATM-CORE-0001',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'active',
    repositoryRoot: root,
    proposedAt,
    inputs: createBaseInputs()
  });
  validateProposal(blockedProposal, validate, 'core blocked active proposal');
  assert.equal(blockedProposal.status, 'blocked');
  assert.equal(blockedProposal.automatedGates.mapEquivalence.passed, false);
  assert.equal(blockedProposal.automatedGates.blockedGateNames.includes('mapEquivalence'), true);
  assert.deepEqual(blockedProposal.requiredJustification.requiredEvidenceKinds, ['map-equivalence']);
  assert.deepEqual(blockedProposal.requiredJustification.requiredCliOptions, ['--equivalence-report']);

  const readyProposal = proposeAtomicUpgrade({
    atomId: 'ATM-CORE-0001',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'active',
    repositoryRoot: root,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      {
        kind: 'map-equivalence',
        path: path.relative(root, equivalencePath).replace(/\\/g, '/'),
        document: readJson(equivalencePath)
      }
    ]
  });
  validateProposal(readyProposal, validate, 'core active proposal with equivalence');
  assert.equal(readyProposal.status, 'pending');
  assert.equal(readyProposal.automatedGates.mapEquivalence.passed, true);
  assert.equal(readyProposal.requestedReplacementMode, 'active');
  assert.equal(readyProposal.inputs.some((entry: any) => entry.kind === 'map-equivalence'), true);

  const help = runAtm(['upgrade', '--help', '--json']);
  assert.equal(help.exitCode, 0);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--replacement-mode'), true);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--equivalence-report'), true);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--rollback-proof'), true);

  const cliBlocked = runUpgradeCli({ mapId, replacementMode: 'active' });
  assert.equal(cliBlocked.exitCode, 0);
  validateProposal(cliBlocked.parsed.evidence.proposal, validate, 'CLI blocked active proposal');
  assert.equal(cliBlocked.parsed.evidence.proposal.status, 'blocked');
  assert.equal(cliBlocked.parsed.evidence.blockedGateNames.includes('mapEquivalence'), true);
  assert.deepEqual(cliBlocked.parsed.evidence.proposal.requiredJustification.requiredEvidenceKinds, ['map-equivalence']);

  const cliReady = runUpgradeCli({
    mapId,
    replacementMode: 'active',
    extraArgs: ['--equivalence-report', equivalencePath]
  });
  assert.equal(cliReady.exitCode, 0);
  validateProposal(cliReady.parsed.evidence.proposal, validate, 'CLI active proposal with equivalence');
  assert.equal(cliReady.parsed.evidence.proposal.status, 'pending');
  assert.equal(cliReady.parsed.evidence.proposal.automatedGates.mapEquivalence.passed, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[upgrade:map-equivalence] ok');

function compileUpgradeProposalValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(path.join(root, 'schemas', 'upgrade', 'upgrade-proposal.schema.json')));
}

function validateProposal(document: unknown, validate: any, label: string) {
  const valid = validate(document) === true;
  assert.equal(valid, true, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

function createBaseInputs() {
  return [
    createInput('hash-diff', 'fixtures/upgrade/hash-diff-report.json'),
    createInput('execution-evidence', 'tests/schema-fixtures/positive/minimal-execution-evidence.json'),
    createInput('non-regression', 'tests/police-fixtures/positive/non-regression-report.json'),
    createInput('quality-comparison', 'fixtures/upgrade/quality-comparison-pass.json'),
    createInput('registry-candidate', 'tests/police-fixtures/positive/registry-candidate-report.json')
  ];
}

function createInput(kind: string, relativePath: string) {
  return {
    kind,
    path: relativePath,
    document: readJson(path.join(root, relativePath))
  };
}

function createPassingMapEquivalenceReport(targetMapId: string) {
  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Map equivalence report fixture for upgrade gate tests.'
    },
    reportId: `map-equivalence.${targetMapId.toLowerCase()}.gate-pass`,
    generatedAt: proposedAt,
    mapId: targetMapId,
    legacyUris: ['legacy://samples/checkout-mini'],
    fixtures: [
      {
        fixtureId: 'fixture.checkout.basic',
        path: 'fixtures/equivalence/checkout-basic.json',
        description: 'Upgrade-gate equivalence fixture.'
      }
    ],
    cases: [
      {
        caseId: 'case.checkout.basic',
        input: { subtotal: 100 },
        expected: { total: 100, currency: 'USD' },
        actual: { total: 100, currency: 'USD' },
        metric: {
          name: 'semanticMatch',
          baseline: 1,
          current: 1,
          delta: 0,
          direction: 'higher-is-better',
          tolerance: 0,
          passed: true
        },
        evidenceRefs: ['evidence://map-equivalence/case.checkout.basic'],
        passed: true,
        knownDivergence: false
      }
    ],
    summary: {
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      knownDivergenceCount: 0
    },
    metrics: {
      latency: 10,
      errorRate: 0,
      coverage: 1,
      edgeCaseCount: 0
    },
    artifacts: [
      {
        artifactPath: `atomic_workbench/maps/${targetMapId}/map.equivalence.report.json`,
        artifactKind: 'report',
        producedBy: 'map-equivalence-runner'
      }
    ],
    evidence: [
      {
        evidenceKind: 'validation',
        signalScope: 'atom-map',
        atomMapId: targetMapId,
        summary: 'Map equivalence fixtures passed for upgrade gating.',
        artifactPaths: [`atomic_workbench/maps/${targetMapId}/map.equivalence.report.json`]
      }
    ],
    passed: true
  };
}

function runUpgradeCli(options: { mapId: string; replacementMode: string; extraArgs?: string[] }) {
  const args = [
    path.join(root, 'atm.mjs'),
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--target', 'map',
    '--map', options.mapId,
    '--replacement-mode', options.replacementMode,
    '--dry-run',
    '--json',
    '--proposed-at', proposedAt,
    '--input', path.join(root, 'fixtures', 'upgrade', 'hash-diff-report.json'),
    '--input', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json'),
    '--input', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'),
    ...(options.extraArgs ?? [])
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse((result.stdout || result.stderr || '').trim())
  };
}

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse((result.stdout || result.stderr || '').trim())
  };
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, document: unknown) {
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}