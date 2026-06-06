import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createPolymorphImpactReport } from '../../packages/core/src/polymorph/impact.ts';
import { proposeAtomicUpgrade } from '../../packages/core/src/upgrade/propose.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-polymorph-impact-');
const targetMapId = 'ATM-MAP-9000';
const impactedMapId = 'ATM-MAP-9001';
const unrelatedMapId = 'ATM-MAP-9002';
const targetAtomId = 'ATM-TPL-9001';
const impactedAtomId = 'ATM-INS-9001';
const auxAtomId = 'ATM-AUX-9001';
const unrelatedAtomId = 'ATM-OTH-9001';
const templateId = 'ATM-POLY-0001';
const proposedAt = '2026-05-17T00:00:00.000Z';

try {
  seedWorkspace(tempRoot);
  const upgradeValidator = compileSchema('schemas/upgrade/upgrade-proposal.schema.json');
  const impactValidator = compileSchema('schemas/governance/polymorph-impact-report.schema.json');
  const equivalencePath = path.join(tempRoot, 'map-equivalence.pass.json');
  writeJson(equivalencePath, createPassingMapEquivalenceReport(targetMapId));

  const impactReport = createPolymorphImpactReport({
    repositoryRoot: tempRoot,
    mapId: targetMapId,
    atomId: targetAtomId,
    toVersion: '2.0.0',
    requestedReplacementMode: 'active',
    generatedAt: proposedAt
  });
  assert.equal(impactValidator(impactReport), true, JSON.stringify(impactValidator.errors));
  assert.deepEqual(impactReport.templateHits.map((entry: any) => entry.templateId), [templateId]);
  assert.deepEqual(impactReport.impactedMapIds, [impactedMapId]);
  assert.equal(impactReport.impactedMaps[0].mapId, impactedMapId);
  assert.equal(impactReport.propagation[0].templateId, templateId);
  assert.equal(impactReport.propagation[0].propagatedCount, 1);
  assert.equal(impactReport.propagation[0].propagatedInstances[0].mapId, impactedMapId);

  const impactReportPath = path.join(tempRoot, 'polymorph-impact-report.pass.json');
  writeJson(impactReportPath, impactReport);

  const specValidate = runAtm(['spec', '--validate', impactReportPath, '--json']);
  assert.equal(specValidate.exitCode, 0, specValidate.raw);
  assert.equal(specValidate.parsed.ok, true);
  assert.equal(specValidate.parsed.evidence.schemaId, 'atm.polymorphImpactReport');

  const blockedProposal = proposeAtomicUpgrade({
    atomId: targetAtomId,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    target: { kind: 'map', mapId: targetMapId },
    requestedReplacementMode: 'active',
    repositoryRoot: tempRoot,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      createInput('map-equivalence', equivalencePath)
    ]
  });
  assert.equal(upgradeValidator(blockedProposal), true, JSON.stringify(upgradeValidator.errors));
  assert.equal(blockedProposal.status, 'blocked');
  assert.equal(blockedProposal.automatedGates.polymorphImpact.passed, false);
  assert.equal(blockedProposal.automatedGates.blockedGateNames.includes('polymorphImpact'), true);
  assert.deepEqual(blockedProposal.requiredJustification.requiredEvidenceKinds, ['polymorph-impact']);
  assert.deepEqual(blockedProposal.requiredJustification.requiredCliOptions, ['--polymorph-impact-report']);

  const readyProposal = proposeAtomicUpgrade({
    atomId: targetAtomId,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    target: { kind: 'map', mapId: targetMapId },
    requestedReplacementMode: 'active',
    repositoryRoot: tempRoot,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      createInput('map-equivalence', equivalencePath),
      createInput('polymorph-impact', impactReportPath)
    ]
  });
  assert.equal(upgradeValidator(readyProposal), true, JSON.stringify(upgradeValidator.errors));
  assert.equal(readyProposal.status, 'pending');
  assert.equal(readyProposal.automatedGates.polymorphImpact.passed, true);
  assert.equal(readyProposal.inputs.some((entry: any) => entry.kind === 'polymorph-impact'), true);

  const help = runAtm(['upgrade', '--help', '--json']);
  assert.equal(help.exitCode, 0, help.raw);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--polymorph-impact-report'), true);

  const cliBlocked = runUpgradeCli({
    equivalencePath
  });
  assert.equal(cliBlocked.exitCode, 0, cliBlocked.raw);
  assert.equal(upgradeValidator(cliBlocked.parsed.evidence.proposal), true, JSON.stringify(upgradeValidator.errors));
  assert.equal(cliBlocked.parsed.evidence.proposal.status, 'blocked');
  assert.equal(cliBlocked.parsed.evidence.proposal.automatedGates.polymorphImpact.passed, false);
  assert.deepEqual(cliBlocked.parsed.evidence.proposal.requiredJustification.requiredEvidenceKinds, ['polymorph-impact']);
  assert.equal(cliBlocked.parsed.evidence.nextActionHint.route, 'polymorph-impact-required');

  const cliReady = runUpgradeCli({
    equivalencePath,
    impactReportPath
  });
  assert.equal(cliReady.exitCode, 0, cliReady.raw);
  assert.equal(upgradeValidator(cliReady.parsed.evidence.proposal), true, JSON.stringify(upgradeValidator.errors));
  assert.equal(cliReady.parsed.evidence.proposal.status, 'pending');
  assert.equal(cliReady.parsed.evidence.proposal.automatedGates.polymorphImpact.passed, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[polymorph-impact:test] ok (report schema, instance scan, active gate block/unblock, cli option)');

function seedWorkspace(repositoryRoot: string) {
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'maps', targetMapId, 'map.spec.json'), {
    mapId: targetMapId,
    members: [
      { atomId: targetAtomId, version: '1.0.0' },
      { atomId: auxAtomId, version: '1.0.0' }
    ]
  });
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'maps', impactedMapId, 'map.spec.json'), {
    mapId: impactedMapId,
    members: [
      { atomId: impactedAtomId, version: '1.0.0' }
    ]
  });
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'maps', unrelatedMapId, 'map.spec.json'), {
    mapId: unrelatedMapId,
    members: [
      { atomId: unrelatedAtomId, version: '1.0.0' }
    ]
  });

  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'atoms', targetAtomId, 'atom.spec.json'), {
    id: targetAtomId,
    polymorphGroupId: templateId
  });
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'atoms', impactedAtomId, 'atom.spec.json'), {
    id: impactedAtomId,
    polymorphicTemplateRef: templateId,
    polymorphGroupId: templateId
  });
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'atoms', auxAtomId, 'atom.spec.json'), {
    id: auxAtomId
  });
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'atoms', unrelatedAtomId, 'atom.spec.json'), {
    id: unrelatedAtomId
  });

  writeJson(path.join(repositoryRoot, 'atomic-registry.json'), {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Temporary polymorph impact fixture registry.'
    },
    registryId: 'registry.polymorph-impact.fixture',
    generatedAt: proposedAt,
    entries: [
      atomEntry(targetAtomId),
      atomEntry(impactedAtomId),
      atomEntry(auxAtomId),
      atomEntry(unrelatedAtomId),
      mapEntry(targetMapId, [
        { atomId: targetAtomId, version: '1.0.0' },
        { atomId: auxAtomId, version: '1.0.0' }
      ]),
      mapEntry(impactedMapId, [
        { atomId: impactedAtomId, version: '1.0.0' }
      ]),
      mapEntry(unrelatedMapId, [
        { atomId: unrelatedAtomId, version: '1.0.0' }
      ])
    ]
  });
}

function atomEntry(atomId: string) {
  return {
    schemaId: 'atm.atomicSpec',
    atomId,
    specPath: `atomic_workbench/atoms/${atomId}/atom.spec.json`,
    location: {
      specPath: `atomic_workbench/atoms/${atomId}/atom.spec.json`
    }
  };
}

function mapEntry(mapId: string, members: Array<{ atomId: string; version: string }>) {
  return {
    schemaId: 'atm.atomicMap',
    mapId,
    members
  };
}

function createBaseInputs() {
  const hashDiffPath = path.join(tempRoot, 'hash-diff-report.json');
  writeJson(hashDiffPath, {
    schemaId: 'atm.hashDiffReport',
    reportId: 'hash-diff.polymorph-impact.fixture',
    atomId: targetAtomId,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    changedPaths: [`atomic_workbench/atoms/${targetAtomId}/atom.spec.json`]
  });
  return [
    createInput('hash-diff', hashDiffPath),
    createInput('execution-evidence', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json')),
    createInput('non-regression', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json')),
    createInput('quality-comparison', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json')),
    createInput('registry-candidate', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'))
  ];
}

function createInput(kind: string, filePath: string) {
  return {
    kind,
    path: filePath.replace(/\\/g, '/'),
    document: readJson(filePath)
  };
}

function createPassingMapEquivalenceReport(mapId: string) {
  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Equivalence report fixture for polymorph gate tests.'
    },
    reportId: `map-equivalence.${mapId.toLowerCase()}.pass`,
    generatedAt: proposedAt,
    mapId,
    legacyUris: ['legacy://samples/polymorph-checkout'],
    fixtures: [
      {
        fixtureId: 'fixture.polymorph.basic',
        path: 'fixtures/equivalence/polymorph-basic.json'
      }
    ],
    cases: [
      {
        caseId: 'case.polymorph.basic',
        input: { subtotal: 100 },
        expected: { total: 100 },
        actual: { total: 100 },
        metric: {
          name: 'semanticMatch',
          baseline: 1,
          current: 1,
          delta: 0,
          direction: 'higher-is-better',
          tolerance: 0,
          passed: true
        },
        evidenceRefs: ['evidence://map-equivalence/polymorph/basic'],
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
        artifactPath: `atomic_workbench/maps/${mapId}/map.equivalence.report.json`,
        artifactKind: 'report',
        producedBy: 'map-equivalence-runner'
      }
    ],
    evidence: [
      {
        evidenceKind: 'validation',
        signalScope: 'atom-map',
        atomMapId: mapId,
        summary: 'Map equivalence fixtures passed.',
        artifactPaths: [`atomic_workbench/maps/${mapId}/map.equivalence.report.json`]
      }
    ],
    passed: true
  };
}

function compileSchema(relativePath: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  if (relativePath.includes('map-equivalence-report') || relativePath.includes('polymorph-impact-report')) {
    ajv.addSchema(readJson(path.join(root, 'schemas', 'test-report', 'metrics.schema.json')));
  }
  return ajv.compile(readJson(path.join(root, relativePath)));
}

function runUpgradeCli(options: { equivalencePath: string; impactReportPath?: string }) {
  const args = [
    path.join(root, 'atm.mjs'),
    'upgrade',
    '--cwd', tempRoot,
    '--propose',
    '--atom', targetAtomId,
    '--from', '1.0.0',
    '--to', '2.0.0',
    '--target', 'map',
    '--map', targetMapId,
    '--replacement-mode', 'active',
    '--equivalence-report', options.equivalencePath,
    '--dry-run',
    '--json',
    '--proposed-at', proposedAt,
    '--input', path.join(tempRoot, 'hash-diff-report.json'),
    '--input', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json'),
    '--input', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'),
    ...(options.impactReportPath ? ['--polymorph-impact-report', options.impactReportPath] : [])
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  const raw = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    raw,
    parsed: JSON.parse(raw)
  };
}

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const raw = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    raw,
    parsed: JSON.parse(raw || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, document: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}