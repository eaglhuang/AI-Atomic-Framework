import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';
import { createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { createAtomicMapRegistryEntry } from '../../packages/core/src/registry/map-registry.ts';
import { createRollbackProof } from '../../packages/core/src/registry/rollback-proof.ts';
import { createRegistryDocument } from '../../packages/core/src/registry/registry.ts';
import { createPropagationReport } from '../../packages/core/src/test-runner/propagation.ts';
import { resolveCanonicalMapPaths } from '../../packages/core/src/test-runner/map-integration.ts';
import { ReplacementMode, transitionReplacementMode } from '../../packages/core/src/registry/replacement-lane.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

run();

function run() {
  const positiveWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Draft, mapId: 'ATM-MAP-9701' });
  try {
    const transitions = [
      {
        to: ReplacementMode.Shadow,
        now: '2026-01-01T00:00:00.000Z',
        actor: 'tester.shadow',
        reason: 'Map integration evidence accepted.',
        evidenceRefs: ['atomic_workbench/maps/ATM-MAP-9701/map.test.report.json']
      },
      {
        to: ReplacementMode.Canary,
        now: '2026-01-01T00:01:00.000Z',
        actor: 'tester.canary',
        reason: 'Map equivalence evidence accepted.',
        evidenceRefs: ['atomic_workbench/maps/ATM-MAP-9701/map.equivalence.report.json']
      },
      {
        to: ReplacementMode.Active,
        now: '2026-01-01T00:02:00.000Z',
        actor: 'tester.active',
        reason: 'Propagation and review evidence accepted.',
        evidenceRefs: [
          'atomic_workbench/maps/ATM-MAP-9701/map.equivalence.report.json',
          '.atm/history/reports/propagation-report.json',
          '.atm/history/reports/review-advisory.json',
          '.atm/history/reports/human-review-approve.json'
        ]
      },
      {
        to: ReplacementMode.LegacyRetired,
        now: '2026-01-01T00:03:00.000Z',
        actor: 'tester.retire',
        reason: 'Rollback proof accepted.',
        evidenceRefs: ['.atm/history/reports/rollback-proof.json']
      }
    ];

    for (const transition of transitions) {
      const result = transitionReplacementMode(positiveWorkspace.mapId, transition.to, {
        reason: transition.reason,
        evidenceRefs: transition.evidenceRefs
      }, {
        repositoryRoot: positiveWorkspace.repositoryRoot,
        actor: transition.actor,
        now: transition.now
      });
      assert.equal(result.to, transition.to);
      assert.equal(result.registryStatus, 'draft');
    }

    const finalSpec = readJson(path.join(positiveWorkspace.repositoryRoot, positiveWorkspace.paths.specPath));
    assert.equal(finalSpec.replacement.mode, ReplacementMode.LegacyRetired);
    assert.equal(finalSpec.lineageLogRef, `${positiveWorkspace.paths.workbenchPath}/lineage-log.json`);
    assert.equal(finalSpec.replacement.evidenceRefs.includes('.atm/history/reports/rollback-proof.json'), true);

    const finalRegistry = readJson(path.join(positiveWorkspace.repositoryRoot, 'atomic-registry.json'));
    const finalEntry = finalRegistry.entries.find((entry: any) => entry.mapId === positiveWorkspace.mapId);
    assert.equal(finalEntry.status, 'draft');
    assert.equal(finalEntry.replacement.mode, ReplacementMode.LegacyRetired);
    assert.equal(finalEntry.lineageLogRef, `${positiveWorkspace.paths.workbenchPath}/lineage-log.json`);

    const lineageLogPath = path.join(positiveWorkspace.repositoryRoot, positiveWorkspace.paths.workbenchPath, 'lineage-log.json');
    assert.equal(existsSync(lineageLogPath), true);
    const lineageLog = readJson(lineageLogPath);
    assert.equal(lineageLog.schemaId, 'atm.mapLineageLog');
    assert.equal(Array.isArray(lineageLog.transitions), true);
    assert.equal(lineageLog.transitions.length, 4);
    assert.deepEqual(lineageLog.transitions[0], {
      from: ReplacementMode.Draft,
      to: ReplacementMode.Shadow,
      reason: 'Map integration evidence accepted.',
      evidenceRefs: ['atomic_workbench/maps/ATM-MAP-9701/map.test.report.json'],
      actor: 'tester.shadow',
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    assert.equal(lineageLog.transitions[3].timestamp, '2026-01-01T00:03:00.000Z');
    assert.equal(lineageLog.transitions[3].actor, 'tester.retire');

    const jumpWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Draft, mapId: 'ATM-MAP-9702' });
    try {
      assert.throws(() => transitionReplacementMode(jumpWorkspace.mapId, ReplacementMode.Active, {
        evidenceRefs: ['atomic_workbench/maps/ATM-MAP-9702/map.equivalence.report.json']
      }, {
        repositoryRoot: jumpWorkspace.repositoryRoot,
        actor: 'tester.jump',
        now: '2026-01-01T01:00:00.000Z'
      }), /Illegal replacement lane transition/);
    } finally {
      rmSync(jumpWorkspace.repositoryRoot, { recursive: true, force: true });
    }

    const activeMissingEvidenceWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Canary, mapId: 'ATM-MAP-9703' });
    try {
      assert.throws(() => transitionReplacementMode(activeMissingEvidenceWorkspace.mapId, ReplacementMode.Active, {
        evidenceRefs: []
      }, {
        repositoryRoot: activeMissingEvidenceWorkspace.repositoryRoot,
        actor: 'tester.active-missing',
        now: '2026-01-01T02:00:00.000Z'
      }), /requires map equivalence \/ propagation \/ review advisory \/ human review evidence/);
    } finally {
      rmSync(activeMissingEvidenceWorkspace.repositoryRoot, { recursive: true, force: true });
    }

    const retiredMissingEvidenceWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Active, mapId: 'ATM-MAP-9704' });
    try {
      assert.throws(() => transitionReplacementMode(retiredMissingEvidenceWorkspace.mapId, ReplacementMode.LegacyRetired, {
        evidenceRefs: []
      }, {
        repositoryRoot: retiredMissingEvidenceWorkspace.repositoryRoot,
        actor: 'tester.retire-missing',
        now: '2026-01-01T03:00:00.000Z'
      }), /requires rollback proof or retirement proof/);
    } finally {
      rmSync(retiredMissingEvidenceWorkspace.repositoryRoot, { recursive: true, force: true });
    }

    const cliWorkspace = createFixtureWorkspace({ initialMode: ReplacementMode.Draft, mapId: 'ATM-MAP-9705' });
    try {
      const cliResult = spawnSync(process.execPath, [
        path.join(root, 'atm.mjs'),
        'replacement-lane',
        'transition',
        '--cwd', cliWorkspace.repositoryRoot,
        '--map', cliWorkspace.mapId,
        '--to', ReplacementMode.Shadow,
        '--evidence', 'atomic_workbench/maps/ATM-MAP-9705/map.test.report.json',
        '--reason', 'CLI transition.',
        '--actor', 'cli.tester',
        '--at', '2026-01-01T04:00:00.000Z',
        '--json'
      ], {
        cwd: root,
        encoding: 'utf8'
      });
      assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
      const cliPayload = JSON.parse(cliResult.stdout);
      assert.equal(cliPayload.ok, true);
      assert.equal(cliPayload.command, 'replacement-lane');
      assert.equal(cliPayload.evidence.from, ReplacementMode.Draft);
      assert.equal(cliPayload.evidence.to, ReplacementMode.Shadow);
      assert.equal(cliPayload.evidence.registryStatus, 'draft');
      assert.equal(cliPayload.evidence.transitionRecord.actor, 'cli.tester');

      const helpResult = spawnSync(process.execPath, [
        path.join(root, 'atm.mjs'),
        'replacement-lane',
        '--help',
        '--json'
      ], {
        cwd: root,
        encoding: 'utf8'
      });
      assert.equal(helpResult.status, 0, helpResult.stderr || helpResult.stdout);
      const helpPayload = JSON.parse(helpResult.stdout);
      assert.equal(helpPayload.ok, true);
      assert.equal(helpPayload.evidence.usage.command, 'replacement-lane');
    } finally {
      rmSync(cliWorkspace.repositoryRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(positiveWorkspace.repositoryRoot, { recursive: true, force: true });
  }

  console.log('[registry:replacement-lane] ok (core forward chain, illegal jump, missing evidence, lineage, registry independence, cli)');
}

function createFixtureWorkspace(options: { initialMode: string; mapId: string }) {
  const repositoryRoot = createTempWorkspace('atm-replacement-lane-');
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
  writeReplacementEvidenceFixtures(repositoryRoot, mapId);

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

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, document: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function writeReplacementEvidenceFixtures(repositoryRoot: string, mapId: string) {
  writeJson(path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.equivalence.report.json'), createPassingMapEquivalenceReport(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'propagation-report.json'), createPassingPropagationReport(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'review-advisory.json'), createPassingReviewAdvisory(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'human-review-approve.json'), createApprovedHumanReviewDecision(mapId));
  writeJson(path.join(repositoryRoot, '.atm', 'history', 'reports', 'rollback-proof.json'), createPassingRollbackProof(mapId));
}

function createPassingMapEquivalenceReport(mapId: string) {
  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Replacement lane map equivalence fixture.'
    },
    reportId: `map-equivalence.${mapId.toLowerCase()}.lane-pass`,
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
        durationMs: 8,
        resolutionMode: 'canonical',
        reportPath: `atomic_workbench/maps/${mapId}/map.test.report.json`,
        warnings: []
      }
    ],
    failedDownstream: [],
    propagationDuration: 8,
    metrics: {
      latency: 8,
      errorRate: 0,
      coverage: 1,
      edgeCaseCount: 0
    },
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      durationMs: 8
    }
  }, {
    atomId: 'ATM-CORE-0001',
    behaviorId: 'behavior.evolve',
    generatedAt: '2026-01-01T00:00:00.000Z',
    reportId: `propagation.${mapId.toLowerCase()}.lane-pass`
  });
}

function createPassingReviewAdvisory(mapId: string) {
  return {
    schemaVersion: '1.0.0',
    reportId: `review-advisory.${mapId.toLowerCase()}.lane-pass`,
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
        proposalId: `proposal.${mapId.toLowerCase()}.lane-pass`,
        queueRecordStatus: 'pending'
      }
    },
    advisoryUnavailable: false,
    needsReview: false,
    unavailableReasons: []
  };
}

function createApprovedHumanReviewDecision(mapId: string) {
  return {
    schemaId: 'atm.humanReviewDecision',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Replacement lane human review fixture.'
    },
    decisionId: `decision.${mapId.toLowerCase()}.approve`,
    proposalId: `proposal.${mapId.toLowerCase()}.lane-pass`,
    atomId: 'ATM-CORE-0001',
    decision: 'approve',
    reason: 'Lane evidence approved.',
    decidedBy: 'ATM reviewer',
    decidedAt: '2026-01-01T00:00:00.000Z',
    decisionSnapshotHash: `sha256:${'b'.repeat(64)}`,
    queuePath: '.atm/history/reports/upgrade-proposals.json',
    projectionPath: '.atm/history/reports/upgrade-proposals.md',
    queueRecord: {
      proposalId: `proposal.${mapId.toLowerCase()}.lane-pass`,
      atomId: 'ATM-CORE-0001',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      decompositionDecision: 'map-bump',
      automatedGates: {
        allPassed: true,
        blockedGateNames: []
      },
      status: 'approved',
      proposalSnapshotHash: `sha256:${'b'.repeat(64)}`,
      proposal: {
        schemaId: 'atm.upgradeProposal',
        proposalId: `proposal.${mapId.toLowerCase()}.lane-pass`,
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

function createPassingRollbackProof(mapId: string) {
  return createRollbackProof({
    targetKind: 'map',
    mapId,
    fromVersion: '1.1.0',
    toVersion: '1.0.0',
    behaviorId: 'behavior.evolve',
    reverseBehaviorId: 'behavior.rollback-evolve',
    hashesVerified: {
      spec: true,
      code: true,
      test: true,
      allVerified: true
    },
    verifiedAt: '2026-01-01T00:00:00.000Z',
    statusReverted: true,
    semanticFingerprintReverted: true,
    memberAtomProofs: [
      {
        atomId: 'ATM-CORE-0001',
        version: '1.0.0',
        expected: createHashTriplet('a'),
        actual: createHashTriplet('a'),
        matched: true
      }
    ],
    mapGeneratorProvenance: true,
    mapWorkbenchResolution: {
      canonicalPath: `atomic_workbench/maps/${mapId}`,
      legacyPath: `legacy/maps/${mapId}`,
      selectedPath: `atomic_workbench/maps/${mapId}`,
      selectedSource: 'canonical'
    }
  });
}

function createHashTriplet(hexDigit: string) {
  const payload = `sha256:${hexDigit.repeat(64)}`;
  return {
    specHash: payload,
    codeHash: payload,
    testHash: payload
  };
}