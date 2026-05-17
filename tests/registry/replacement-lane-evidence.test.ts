import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { createAtomicMapRegistryEntry } from '../../packages/core/src/registry/map-registry.ts';
import { ReplacementMode, transitionReplacementMode } from '../../packages/core/src/registry/replacement-lane.ts';
import { createRetirementProof } from '../../packages/core/src/registry/retirement-proof.ts';
import { createRegistryDocument } from '../../packages/core/src/registry/registry.ts';
import { createPropagationReport } from '../../packages/core/src/test-runner/propagation.ts';
import { resolveCanonicalMapPaths } from '../../packages/core/src/test-runner/map-integration.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const blockedWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Canary, mapId: 'ATM-MAP-9801' });
try {
  assert.throws(() => transitionReplacementMode(blockedWorkspace.mapId, ReplacementMode.Active, {
    evidenceRefs: ['atomic_workbench/maps/ATM-MAP-9801/map.equivalence.report.json']
  }, {
    repositoryRoot: blockedWorkspace.repositoryRoot,
    actor: 'tester.blocked',
    now: '2026-01-01T00:00:00.000Z'
  }), (error: any) => {
    assert.equal(error?.code, 'ATM_REPLACEMENT_TRANSITION_INVALID');
    assert.deepEqual(error?.details?.blockedGateNames, ['propagationReport', 'reviewAdvisory', 'humanReview']);
    assert.deepEqual(error?.details?.requiredJustification?.requiredEvidenceKinds, ['propagation-report', 'review-advisory', 'human-review']);
    assert.equal(error?.details?.nextActionHint?.route, 'replacement-evidence-required');
    return true;
  });
} finally {
  rmSync(blockedWorkspace.repositoryRoot, { recursive: true, force: true });
}

const activeReadyWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Canary, mapId: 'ATM-MAP-9802' });
try {
  const result = transitionReplacementMode(activeReadyWorkspace.mapId, ReplacementMode.Active, {
    evidenceRefs: [
      'atomic_workbench/maps/ATM-MAP-9802/map.equivalence.report.json',
      '.atm/history/reports/propagation-report.json',
      '.atm/history/reports/review-advisory.json',
      '.atm/history/reports/human-review-approve.json'
    ]
  }, {
    repositoryRoot: activeReadyWorkspace.repositoryRoot,
    actor: 'tester.active',
    now: '2026-01-01T00:01:00.000Z'
  });
  assert.equal(result.to, ReplacementMode.Active);
} finally {
  rmSync(activeReadyWorkspace.repositoryRoot, { recursive: true, force: true });
}

const retireReadyWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Active, mapId: 'ATM-MAP-9803' });
try {
  const result = transitionReplacementMode(retireReadyWorkspace.mapId, ReplacementMode.LegacyRetired, {
    evidenceRefs: ['.atm/history/reports/retirement-proof.json']
  }, {
    repositoryRoot: retireReadyWorkspace.repositoryRoot,
    actor: 'tester.retire',
    now: '2026-01-01T00:02:00.000Z'
  });
  assert.equal(result.to, ReplacementMode.LegacyRetired);
} finally {
  rmSync(retireReadyWorkspace.repositoryRoot, { recursive: true, force: true });
}

console.log('[registry:replacement-lane-evidence] ok');

function createFixtureWorkspace(options: { initialMode: string; mapId: string }) {
  const repositoryRoot = createTempWorkspace('atm-replacement-lane-evidence-');
  const mapId = options.mapId;
  const paths = resolveCanonicalMapPaths(mapId);
  mkdirSync(path.join(repositoryRoot, paths.workbenchPath), { recursive: true });
  mkdirSync(path.join(repositoryRoot, '.atm', 'history', 'reports'), { recursive: true });

  const spec = createMinimalAtomicMapSpec({
    mapId,
    specVersion: '0.2.0',
    mapVersion: '0.1.0',
    members: [
      { atomId: 'ATM-CORE-0001', version: '1.0.0', role: 'entry-adapter' }
    ],
    edges: [],
    entrypoints: ['ATM-CORE-0001'],
    qualityTargets: {
      promoteGateRequired: true,
      requiredChecks: 1
    },
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: options.initialMode,
      evidenceRefs: []
    }
  });
  writeJson(path.join(repositoryRoot, paths.specPath), spec);
  writeFileSync(path.join(repositoryRoot, paths.testPath), "console.log('integration ok');\n", 'utf8');
  writeJson(path.join(repositoryRoot, paths.reportPath), { ok: true, mapId });
  writeEvidenceFixtures(repositoryRoot, mapId);

  const registryEntry = createAtomicMapRegistryEntry(spec as any, {
    status: 'draft',
    governanceTier: 'standard',
    location: {
      specPath: paths.specPath,
      codePaths: [],
      testPaths: [paths.testPath],
      reportPath: paths.reportPath,
      workbenchPath: paths.workbenchPath
    },
    evidence: [paths.specPath, paths.testPath, paths.reportPath],
    semanticFingerprint: spec.semanticFingerprint
  });
  const registryDocument = createRegistryDocument([registryEntry], {
    registryId: 'registry.fixture',
    generatedAt: '2026-01-01T00:00:00.000Z'
  });
  writeJson(path.join(repositoryRoot, 'atomic-registry.json'), registryDocument);

  return {
    repositoryRoot,
    mapId,
    paths
  };
}

function writeEvidenceFixtures(repositoryRoot: string, mapId: string) {
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.equivalence.report.json'), createPassingMapEquivalenceReport(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'propagation-report.json'), createPassingPropagationReport(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'review-advisory.json'), createPassingReviewAdvisory(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'human-review-approve.json'), createApprovedHumanReviewDecision(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'retirement-proof.json'), createPassingRetirementProof(mapId));
}

function createPassingMapEquivalenceReport(mapId: string) {
  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Replacement lane evidence equivalence fixture.'
    },
    reportId: `map-equivalence.${mapId.toLowerCase()}.lane-evidence-pass`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mapId,
    legacyUris: ['legacy://samples/checkout-mini'],
    fixtures: [],
    cases: [],
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
    artifacts: [],
    evidence: [],
    passed: true
  };
}

function createPassingPropagationReport(mapId: string) {
  return createPropagationReport({
    ok: true,
    discoveredMaps: [mapId],
    perMapStatus: [
      {
        mapId,
        ok: true,
        exitCode: 0,
        durationMs: 6,
        resolutionMode: 'canonical',
        reportPath: `atomic_workbench/maps/${mapId}/map.test.report.json`,
        warnings: []
      }
    ],
    failedDownstream: [],
    propagationDuration: 6,
    metrics: {
      latency: 6,
      errorRate: 0,
      coverage: 1,
      edgeCaseCount: 0
    },
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      durationMs: 6
    }
  }, {
    atomId: 'ATM-CORE-0001',
    behaviorId: 'behavior.evolve',
    generatedAt: '2026-01-01T00:00:00.000Z',
    reportId: `propagation.${mapId.toLowerCase()}.lane-evidence-pass`
  });
}

function createPassingReviewAdvisory(mapId: string) {
  return {
    schemaVersion: '1.0.0',
    reportId: `review-advisory.${mapId.toLowerCase()}.lane-evidence-pass`,
    status: 'ok',
    provider: {
      mode: 'stub',
      providerId: 'stub-provider',
      providerVersion: '1.0.0',
      transport: 'inproc'
    },
    generatedAt: '2026-01-01T00:00:00.000Z',
    target: {
      kind: 'map',
      id: mapId
    },
    summary: {
      high: 0,
      medium: 0,
      low: 0,
      info: 1
    },
    findings: [],
    supplementalContext: {
      humanReviewQueue: {
        attachable: true,
        queuePath: '.atm/history/reports/upgrade-proposals.json',
        proposalId: `proposal.${mapId.toLowerCase()}.lane-evidence-pass`,
        queueRecordStatus: 'pending'
      }
    },
    advisoryUnavailable: false,
    needsReview: false,
    unavailableReasons: []
  };
}

function createApprovedHumanReviewDecision(mapId: string) {
  const decisionSnapshotHash = `sha256:${'c'.repeat(64)}`;
  return {
    schemaId: 'atm.humanReviewDecision',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Replacement lane evidence human review fixture.'
    },
    decisionId: `decision.${mapId.toLowerCase()}.approve`,
    proposalId: `proposal.${mapId.toLowerCase()}.lane-evidence-pass`,
    atomId: 'ATM-CORE-0001',
    decision: 'approve',
    reason: 'Lane evidence approved.',
    decidedBy: 'ATM reviewer',
    decidedAt: '2026-01-01T00:00:00.000Z',
    decisionSnapshotHash,
    queuePath: '.atm/history/reports/upgrade-proposals.json',
    projectionPath: '.atm/history/reports/upgrade-proposals.md',
    queueRecord: {
      proposalId: `proposal.${mapId.toLowerCase()}.lane-evidence-pass`,
      atomId: 'ATM-CORE-0001',
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
        proposalId: `proposal.${mapId.toLowerCase()}.lane-evidence-pass`,
        atomId: 'ATM-CORE-0001',
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
      }
    }
  };
}

function createPassingRetirementProof(mapId: string) {
  return createRetirementProof({
    mapId,
    mapVersion: '1.1.0',
    verifiedAt: '2026-01-01T00:00:00.000Z',
    verifiedBy: 'ATM reviewer',
    retiredLegacyUris: ['legacy://samples/checkout-mini'],
    callerRiskCleared: true,
    entrypointRiskCleared: true,
    unresolvedCallers: [],
    unresolvedEntrypoints: [],
    reviewAdvisoryRefs: [`review-advisory.${mapId.toLowerCase()}.lane-evidence-pass`],
    notes: 'Legacy callers and entrypoints have been removed.'
  });
}

function writeJson(filePath: string, document: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}