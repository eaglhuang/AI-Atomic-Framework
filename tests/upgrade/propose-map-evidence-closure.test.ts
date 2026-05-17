import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRetirementProof } from '../../packages/core/src/registry/retirement-proof.ts';
import { createPropagationReport } from '../../packages/core/src/test-runner/propagation.ts';
import { proposeAtomicUpgrade } from '../../packages/core/src/upgrade/propose.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-upgrade-map-evidence-closure-');
const atomId = 'ATM-CORE-0001';
const mapId = 'ATM-MAP-0001';
const proposedAt = '2026-01-01T00:00:00.000Z';

try {
  const validate = compileUpgradeProposalValidator();
  const equivalencePath = path.join(tempRoot, 'map-equivalence.pass.json');
  const propagationPath = path.join(tempRoot, 'propagation-report.pass.json');
  const reviewAdvisoryPath = path.join(tempRoot, 'review-advisory.pass.json');
  const humanReviewPath = path.join(tempRoot, 'human-review.approve.json');
  const retirementProofPath = path.join(tempRoot, 'retirement-proof.pass.json');

  const activeProposalId = createMapProposalId();
  writeJson(equivalencePath, createPassingMapEquivalenceReport(mapId));
  writeJson(propagationPath, createPassingPropagationReport());
  writeJson(reviewAdvisoryPath, createPassingReviewAdvisory(activeProposalId));
  writeJson(humanReviewPath, createApprovedHumanReviewDecision(activeProposalId));
  writeJson(retirementProofPath, createPassingRetirementProof());

  const blockedActiveProposal = proposeAtomicUpgrade({
    atomId,
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'active',
    repositoryRoot: root,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      createTempInput('map-equivalence', equivalencePath)
    ]
  });
  validateProposal(blockedActiveProposal, validate, 'core blocked active proposal');
  assert.equal(blockedActiveProposal.status, 'blocked');
  assert.equal(blockedActiveProposal.automatedGates.mapEquivalence.passed, true);
  assert.equal(blockedActiveProposal.automatedGates.propagationReport.passed, false);
  assert.equal(blockedActiveProposal.automatedGates.reviewAdvisory.passed, false);
  assert.equal(blockedActiveProposal.automatedGates.humanReview.passed, false);
  assert.deepEqual(blockedActiveProposal.requiredJustification.requiredEvidenceKinds, ['propagation-report', 'review-advisory', 'human-review']);
  assert.deepEqual(blockedActiveProposal.requiredJustification.requiredCliOptions, ['--propagation-report', '--review-advisory', '--human-review']);

  const readyActiveProposal = proposeAtomicUpgrade({
    atomId,
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'active',
    repositoryRoot: root,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      createTempInput('map-equivalence', equivalencePath),
      createTempInput('propagation-report', propagationPath),
      createTempInput('review-advisory', reviewAdvisoryPath),
      createTempInput('human-review', humanReviewPath)
    ]
  });
  validateProposal(readyActiveProposal, validate, 'core ready active proposal');
  assert.equal(readyActiveProposal.status, 'pending');
  assert.equal(readyActiveProposal.automatedGates.propagationReport.passed, true);
  assert.equal(readyActiveProposal.automatedGates.reviewAdvisory.passed, true);
  assert.equal(readyActiveProposal.automatedGates.humanReview.passed, true);

  const blockedRetirementProposal = proposeAtomicUpgrade({
    atomId,
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'legacy-retired',
    repositoryRoot: root,
    proposedAt,
    inputs: createBaseInputs()
  });
  validateProposal(blockedRetirementProposal, validate, 'core blocked legacy-retired proposal');
  assert.equal(blockedRetirementProposal.status, 'blocked');
  assert.deepEqual(blockedRetirementProposal.requiredJustification.requiredEvidenceKinds, ['rollback-proof', 'retirement-proof']);
  assert.equal(blockedRetirementProposal.automatedGates.blockedGateNames.includes('rollbackProof'), true);
  assert.equal(blockedRetirementProposal.automatedGates.blockedGateNames.includes('retirementProof'), true);

  const readyRetirementProposal = proposeAtomicUpgrade({
    atomId,
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'legacy-retired',
    repositoryRoot: root,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      createTempInput('retirement-proof', retirementProofPath)
    ]
  });
  validateProposal(readyRetirementProposal, validate, 'core ready legacy-retired proposal with retirement proof');
  assert.equal(readyRetirementProposal.status, 'pending');
  assert.equal(readyRetirementProposal.automatedGates.retirementProof.passed, true);
  assert.equal('rollbackProof' in readyRetirementProposal.automatedGates, false);

  const help = runAtm(['upgrade', '--help', '--json']);
  assert.equal(help.exitCode, 0);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--propagation-report'), true);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--review-advisory'), true);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--human-review'), true);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--retirement-proof'), true);

  const cliBlockedActive = runUpgradeCli({
    mapId,
    replacementMode: 'active',
    extraArgs: ['--equivalence-report', equivalencePath]
  });
  assert.equal(cliBlockedActive.exitCode, 0);
  validateProposal(cliBlockedActive.parsed.evidence.proposal, validate, 'CLI blocked active proposal');
  assert.equal(cliBlockedActive.parsed.evidence.proposal.status, 'blocked');
  assert.deepEqual(cliBlockedActive.parsed.evidence.proposal.requiredJustification.requiredEvidenceKinds, ['propagation-report', 'review-advisory', 'human-review']);
  assert.equal(cliBlockedActive.parsed.evidence.nextActionHint != null, true);

  const cliReadyActive = runUpgradeCli({
    mapId,
    replacementMode: 'active',
    extraArgs: [
      '--equivalence-report', equivalencePath,
      '--propagation-report', propagationPath,
      '--review-advisory', reviewAdvisoryPath,
      '--human-review', humanReviewPath
    ]
  });
  assert.equal(cliReadyActive.exitCode, 0);
  validateProposal(cliReadyActive.parsed.evidence.proposal, validate, 'CLI ready active proposal');
  assert.equal(cliReadyActive.parsed.evidence.proposal.status, 'pending');
  assert.equal(cliReadyActive.parsed.evidence.proposal.automatedGates.propagationReport.passed, true);

  const cliReadyRetirement = runUpgradeCli({
    mapId,
    replacementMode: 'legacy-retired',
    extraArgs: ['--retirement-proof', retirementProofPath]
  });
  assert.equal(cliReadyRetirement.exitCode, 0);
  validateProposal(cliReadyRetirement.parsed.evidence.proposal, validate, 'CLI ready legacy-retired proposal');
  assert.equal(cliReadyRetirement.parsed.evidence.proposal.status, 'pending');
  assert.equal(cliReadyRetirement.parsed.evidence.proposal.automatedGates.retirementProof.passed, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[upgrade:map-evidence-closure] ok');

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

function createTempInput(kind: string, absolutePath: string) {
  return {
    kind,
    path: path.relative(root, absolutePath).replace(/\\/g, '/'),
    document: readJson(absolutePath)
  };
}

function createPassingMapEquivalenceReport(targetMapId: string) {
  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Map equivalence report fixture for evidence closure tests.'
    },
    reportId: `map-equivalence.${targetMapId.toLowerCase()}.evidence-pass`,
    generatedAt: proposedAt,
    mapId: targetMapId,
    legacyUris: ['legacy://samples/checkout-mini'],
    fixtures: [
      {
        fixtureId: 'fixture.checkout.basic',
        path: 'fixtures/equivalence/checkout-basic.json',
        description: 'Evidence closure equivalence fixture.'
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
        summary: 'Map equivalence fixtures passed for evidence closure gating.',
        artifactPaths: [`atomic_workbench/maps/${targetMapId}/map.equivalence.report.json`]
      }
    ],
    passed: true
  };
}

function createPassingPropagationReport() {
  return createPropagationReport({
    ok: true,
    discoveredMaps: [mapId],
    perMapStatus: [
      {
        mapId,
        ok: true,
        exitCode: 0,
        durationMs: 12,
        resolutionMode: 'canonical',
        reportPath: `atomic_workbench/maps/${mapId}/map.test.report.json`,
        warnings: []
      }
    ],
    failedDownstream: [],
    propagationDuration: 12,
    metrics: {
      latency: 12,
      errorRate: 0,
      coverage: 1,
      edgeCaseCount: 0
    },
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      durationMs: 12
    }
  }, {
    atomId,
    behaviorId: 'behavior.evolve',
    generatedAt: proposedAt,
    reportId: 'propagation.atm-core-0001.active-pass'
  });
}

function createPassingReviewAdvisory(proposalId: string) {
  return {
    schemaVersion: '1.0.0',
    reportId: 'review-advisory.stub-pass',
    status: 'ok',
    provider: {
      mode: 'stub',
      providerId: 'stub-provider',
      providerVersion: '1.0.0',
      transport: 'inproc'
    },
    generatedAt: proposedAt,
    target: {
      kind: 'proposal',
      id: proposalId
    },
    summary: {
      high: 0,
      medium: 0,
      low: 0,
      info: 1
    },
    findings: [
      {
        id: 'finding.stub.pass',
        severity: 'info',
        trigger: 'semantic-anomaly',
        scope: 'proposal',
        action: 'monitor',
        routeHint: 'human-review.supplemental',
        message: 'No semantic risk surfaced by stub provider.',
        evidenceRefs: ['advisory.stub.pass']
      }
    ],
    supplementalContext: {
      humanReviewQueue: {
        attachable: true,
        queuePath: '.atm/reports/upgrade-proposals.json',
        proposalId,
        queueRecordStatus: 'pending'
      }
    },
    advisoryUnavailable: false,
    needsReview: false,
    unavailableReasons: []
  };
}

function createApprovedHumanReviewDecision(proposalId: string) {
  const decisionSnapshotHash = `sha256:${'a'.repeat(64)}`;
  return {
    schemaId: 'atm.humanReviewDecision',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Human review decision fixture for evidence closure tests.'
    },
    decisionId: `decision.${proposalId}.approve`,
    proposalId,
    atomId,
    decision: 'approve',
    reason: 'Automated gates are green and no manual risk surfaced.',
    decidedBy: 'ATM reviewer',
    decidedAt: proposedAt,
    decisionSnapshotHash,
    queuePath: '.atm/reports/upgrade-proposals.json',
    projectionPath: '.atm/reports/upgrade-proposals.md',
    queueRecord: {
      proposalId,
      atomId,
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      decompositionDecision: 'map-bump',
      automatedGates: {
        allPassed: true,
        blockedGateNames: []
      },
      status: 'approved',
      proposalSnapshotHash: decisionSnapshotHash,
      proposal: {
        schemaId: 'atm.upgradeProposal',
        proposalId,
        atomId,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        target: {
          kind: 'map',
          mapId
        },
        decompositionDecision: 'map-bump',
        status: 'pending',
        automatedGates: {
          allPassed: true,
          blockedGateNames: []
        }
      },
      review: {
        decision: 'approve',
        reason: 'Automated gates are green and no manual risk surfaced.',
        decidedBy: 'ATM reviewer',
        decidedAt: proposedAt,
        decisionSnapshotHash,
        evidenceId: `human-review.${proposalId}.approve`
      }
    }
  };
}

function createPassingRetirementProof() {
  return createRetirementProof({
    mapId,
    mapVersion: '1.1.0',
    verifiedAt: proposedAt,
    verifiedBy: 'ATM reviewer',
    retiredLegacyUris: ['legacy://samples/checkout-mini'],
    callerRiskCleared: true,
    entrypointRiskCleared: true,
    unresolvedCallers: [],
    unresolvedEntrypoints: [],
    reviewAdvisoryRefs: ['review-advisory.stub-pass'],
    notes: 'Legacy callers and entrypoints have been removed.'
  });
}

function createMapProposalId() {
  return 'proposal.atm-core-0001.from-1.0.0.to-1.1.0.map-atm-map-0001.behavior-evolve';
}

function runUpgradeCli(options: { mapId: string; replacementMode: string; extraArgs?: string[] }) {
  const args = [
    path.join(root, 'atm.mjs'),
    'upgrade',
    '--propose',
    '--atom', atomId,
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