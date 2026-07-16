import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  appendMachineFindings,
  buildDecompositionPlanHintDraft,
  buildEvolutionSuppressionKey,
  buildLegacyRoutePlan,
  buildMergedFamily,
  buildPoliceFamilyGateReport,
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey,
  buildSourceInventoryReport,
  compareQualityMetrics,
  createLocalGitAdapter,
  curateAtomMapEvolution,
  createStubReviewAdvisoryReport,
  runAdopterNeutralityCheck,
  runAtomizationPolice,
  runDedupPolice,
  runDemandPolice,
  runDecompositionPolice,
  runEvidenceIntegrityGate,
  runEvolutionPolice,
  runMapIntegrationPolice,
  runNoiseControlGate,
  runPoliceFamilyGate,
  runPolymorphPolice,
  runQualityPolice,
  runRegistryContractDriftCheck,
  runReversibilityGate,
  runRollbackPolice,
  toReviewAdvisoryMachineFinding,
  verifyAdvisoryOnlyHardening,
  VALIDATOR_PROFILE_NAMING_CONTRACT,
  type PoliceFinding
} from './deps.ts';
import type { PoliceFamilyContext } from './context.ts';

export async function runCoreScenarios(ctx: PoliceFamilyContext) {
  const { root, mode, fixture, check, readJson, readText, materializeCuratorInput, buildCoreFamilies, sharedCoreFamilies } = ctx;
  const duplicateRegistry = {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    registryId: 'registry.police-family.dedup',
    generatedAt: '2026-05-18T00:00:00.000Z',
    entries: [
      {
        atomId: 'ATM-DEDUPE-0001',
        currentVersion: '0.1.0',
        semanticFingerprint: 'sf:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        atomId: 'ATM-DEDUPE-0002',
        currentVersion: '0.1.0',
        semanticFingerprint: 'sf:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        atomId: 'ATM-DEDUPE-0003',
        currentVersion: '0.1.0',
        semanticFingerprint: 'sf:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        polymorphGroupId: 'ATM-POLY-DEDUP'
      },
      {
        atomId: 'ATM-DEDUPE-0004',
        currentVersion: '0.1.0',
        semanticFingerprint: 'sf:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        polymorphGroupId: 'ATM-POLY-DEDUP'
      },
      ...Array.from({ length: 120 }, (_, index) => ({
        atomId: `ATM-DLG-${String(index + 1).padStart(4, '0')}`,
        currentVersion: '0.1.0',
        semanticFingerprint: `sf:sha256:${String(index + 1).padStart(64, '0')}`
      }))
    ]
  };

  const qualityPositiveWithDedup = compareQualityMetrics(
    readJson('tests/police-fixtures/regression-compare.fixture.json').positive.find((entry: any) => entry.name === 'v1.2-pass-polymorph-dedup-ignore').input
  );
  const dedupFamily = runDedupPolice({
    registryDocument: duplicateRegistry,
    qualityComparisonReport: qualityPositiveWithDedup,
    polymorphContext: {
      groupId: 'ATM-POLY-DEDUP',
      instanceAtomIds: ['ATM-DEDUPE-0003', 'ATM-DEDUPE-0004', 'ATM-CORE-0002']
    }
  });

  check(dedupFamily.sourceValidator === 'runDedupPolice', 'Dedup Police must be a named scanner');
  check(
    dedupFamily.findings.some((finding) => finding.trigger === 'semantic-fingerprint-overlap'),
    'Dedup Police must produce semantic-fingerprint-overlap finding'
  );
  check(
    !dedupFamily.findings.some((finding) => String(finding.scope).includes('ATM-DEDUPE-0003') || String(finding.scope).includes('ATM-DEDUPE-0004')),
    'Dedup Police must ignore same-polymorph group'
  );
  check(
    readText('packages/core/src/police/roles/dedup.ts').includes('findByFingerprintPrefix'),
    'Dedup Police source must use RegistryIndex fingerprint prefix lookup hot path'
  );

  const demandPlan = await buildLegacyRoutePlan({
    sourceText: [
      'function trunk(){ alpha(); beta(); gamma(); delta(); epsilon(); }',
      'function hotLeaf(){ return 1; }',
      'function calmLeaf(){ return 2; }'
    ].join('\n'),
    targetFile: 'src/legacy-demand.ts',
    releaseBlockerSymbols: ['trunk'],
    callerDistribution: {
      trunk: 12,
      hotLeaf: 7,
      calmLeaf: 2
    },
    demandThreshold: 6
  });
  const demandFamily = await runDemandPolice({
    legacyRoutePlan: demandPlan,
    demandThreshold: 6
  });

  check(demandFamily.sourceValidator === 'runDemandPolice', 'Demand Police must be a named scanner');
  check(
    demandFamily.findings.some((finding) => finding.trigger === 'caller-demand-threshold' && finding.routeHint === 'behavior.split'),
    'Demand Police must route caller-demand-threshold to behavior.split'
  );
  check(!demandFamily.findings.some((finding) => String(finding.scope).includes('trunk')), 'Demand Police must not split trunk no-touch segments');
  check(!demandFamily.findings.some((finding) => String(finding.scope).includes('calmLeaf')), 'Demand Police must not emit below-threshold demand finding');
  check(
    demandFamily.findings.every((finding) => (finding.metadata as any)?.directApplyAllowed === false),
    'Demand Police must not directly apply split proposal'
  );

  const regressionFixture = readJson('tests/police-fixtures/regression-compare.fixture.json');
  const qualityRegressionFamily = runQualityPolice({
    qualityComparisonInput: regressionFixture.negative.find((entry: any) => entry.name === 'v1.1-fail-error-rate').input
  });
  const qualityMapFailureFamily = runQualityPolice({
    qualityComparisonInput: regressionFixture.negative.find((entry: any) => entry.name === 'v1.1-fail-map-integration').input
  });
  const qualityDedupFamily = runQualityPolice({
    qualityComparisonReport: qualityPositiveWithDedup
  });

  check(qualityRegressionFamily.sourceValidator === 'runQualityPolice', 'Quality Police must be a named scanner');
  check(qualityRegressionFamily.status === 'fail', 'Quality regression must fail blocker family');
  check(qualityRegressionFamily.findings.some((finding) => finding.trigger === 'quality-regression' && finding.severity === 'block'), 'Quality regression must produce blocker finding');
  check(qualityMapFailureFamily.findings.some((finding) => finding.trigger === 'map-propagation-failure' && finding.severity === 'block'), 'Map propagation failure must become Quality blocker finding');
  check(qualityDedupFamily.findings.some((finding) => finding.trigger === 'quality-dedup-candidate' && finding.severity === 'advisory'), 'Quality dedup hints must remain advisory');

  const mapComposeReport = curateAtomMapEvolution(materializeCuratorInput('fixtures/evolution/map-curator/caller-graph-compose.json'));
  const mapOverlapReport = curateAtomMapEvolution(materializeCuratorInput('fixtures/evolution/map-curator/input-output-overlap.json'));
  const mapSweepReport = curateAtomMapEvolution(materializeCuratorInput('fixtures/evolution/map-curator/recurring-failure-cluster.json'));
  const mapFamily = buildMergedFamily('map-integration', 'advisory', [
    runMapIntegrationPolice({ curatorReport: mapComposeReport }),
    runMapIntegrationPolice({ curatorReport: mapOverlapReport }),
    runMapIntegrationPolice({ curatorReport: mapSweepReport })
  ]);

  check(mapFamily.sourceValidator === 'runMapIntegrationPolice', 'Map Integration Police must be a named scanner');
  for (const routeHint of ['behavior.compose', 'behavior.merge', 'behavior.dedup-merge', 'behavior.sweep']) {
    check(mapFamily.findings.some((finding) => finding.routeHint === routeHint), `Map Integration Police must surface ${routeHint}`);
  }
  check(
    mapFamily.findings.every((finding) => finding.action === 'proposal-draft' || finding.action === 'monitor' || finding.action === 'needs-review'),
    'Map Integration Police must only produce report/proposal findings'
  );

  const privateTerm = ['3K', 'Life'].join('');
  const adapter = createLocalGitAdapter({ dryRun: true });
  const adapterContext = {
    repositoryRoot: root,
    actor: 'police-family-validator',
    lifecycleMode: 'evolution' as const,
    config: { dryRun: true }
  };
  const dryRunPass = adapter.runAtomizeAdapter(adapterContext, {
    behaviorId: 'behavior.atomize',
    legacySource: 'legacy://framework/src/legacy-atomization.ts#L1',
    dryRun: true,
    inlineSource: 'function safeLeaf(){ return 42; }',
    patchFiles: []
  });
  const dryRunNeutralityFail = adapter.runAtomizeAdapter(adapterContext, {
    behaviorId: 'behavior.atomize',
    legacySource: 'legacy://framework/src/legacy-atomization.ts#L2',
    dryRun: true,
    inlineSource: `function privateLeaf(){ return '${privateTerm}'; }`,
    patchFiles: []
  });
  const dryRunHostMutationAttempt = {
    ok: true,
    dryRunPatch: {
      contractId: 'adapter-atomize:host-mutation-attempt',
      behaviorId: 'behavior.atomize',
      dryRun: false,
      applyToHostProject: true,
      hostMutationAllowed: true,
      patchMode: 'apply'
    },
    neutrality: {
      ok: true,
      violationCount: 0
    }
  };
  const atomizationPlan = await buildLegacyRoutePlan({
    sourceText: [
      'function leafA(){ return 1; }',
      'function adapterBridge(){ return leafA(); }',
      'function matchedLeaf(){ return 3; }'
    ].join('\n'),
    targetFile: 'src/legacy-atomization.ts',
    existingAtomMatches: [{ symbolName: 'matchedLeaf', atomId: 'ATM-CORE-0001' }],
    callerDistribution: {
      leafA: 1,
      adapterBridge: 2,
      matchedLeaf: 1
    }
  });
  const atomizationPassFamily = runAtomizationPolice({
    legacyRoutePlan: atomizationPlan,
    dryRunResult: dryRunPass as unknown as Record<string, unknown>
  });
  const atomizationNeutralityFailFamily = runAtomizationPolice({
    legacyRoutePlan: atomizationPlan,
    dryRunResult: dryRunNeutralityFail as unknown as Record<string, unknown>
  });
  const atomizationHostMutationFamily = runAtomizationPolice({
    legacyRoutePlan: atomizationPlan,
    dryRunResult: dryRunHostMutationAttempt as unknown as Record<string, unknown>
  });

  check(atomizationPassFamily.sourceValidator === 'runAtomizationPolice', 'Atomization Police must be a named scanner');
  check(atomizationPassFamily.findings.some((finding) => finding.routeHint === 'behavior.atomize'), 'Atomization Police must surface atomize candidates');
  check(atomizationPassFamily.findings.some((finding) => finding.routeHint === 'behavior.infect'), 'Atomization Police must surface infect candidates');
  check(!atomizationPassFamily.findings.some((finding) => finding.severity === 'block'), 'Atomization dry-run pass must not block');
  check(atomizationNeutralityFailFamily.findings.some((finding) => finding.trigger === 'dry-run-proposal-guard' && finding.severity === 'block'), 'Neutrality fail must block Atomization Police');
  check(atomizationHostMutationFamily.findings.some((finding) => finding.trigger === 'dry-run-proposal-guard' && finding.severity === 'block'), 'Host mutation attempt must block Atomization Police');
  return { duplicateRegistry, qualityPositiveWithDedup, dedupFamily, demandPlan, demandFamily, regressionFixture, qualityRegressionFamily, qualityDedupFamily, mapComposeReport, mapFamily, atomizationPlan, atomizationPassFamily, dryRunPass };
}
