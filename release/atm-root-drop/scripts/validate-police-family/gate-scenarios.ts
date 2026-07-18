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

export async function runGateScenarios(ctx: PoliceFamilyContext, core: any) {
  const { root, mode, fixture, check, readJson, readText, materializeCuratorInput, buildCoreFamilies, sharedCoreFamilies } = ctx;
  const { duplicateRegistry, qualityPositiveWithDedup, dedupFamily, demandPlan, demandFamily, regressionFixture, qualityRegressionFamily, qualityDedupFamily, mapComposeReport, mapFamily, atomizationPlan, atomizationPassFamily, dryRunPass } = core;
  const positiveGateReport = await runPoliceFamilyGate({
    profile: 'standard',
    coreFamilies: sharedCoreFamilies,
    dedup: {
      registryDocument: duplicateRegistry,
      qualityComparisonReport: qualityPositiveWithDedup,
      polymorphContext: {
        groupId: 'ATM-POLY-DEDUP',
        instanceAtomIds: ['ATM-DEDUPE-0003', 'ATM-DEDUPE-0004', 'ATM-CORE-0002']
      }
    },
    demand: {
      legacyRoutePlan: demandPlan,
      demandThreshold: 6
    },
    quality: {
      qualityComparisonInput: regressionFixture.positive.find((entry: any) => entry.name === 'v1.1-pass-with-map-scope').input
    },
    mapIntegration: {
      curatorReport: mapComposeReport
    },
    atomization: {
      legacyRoutePlan: atomizationPlan,
      dryRunResult: dryRunPass as unknown as Record<string, unknown>
    },
    decomposition: {
      inventory: buildSourceInventoryReport({
        maxFileLines: 1000,
        entries: [
          readJson('fixtures/police-family/decomposition/positive-oversized.json').input.inventory.entries[0]
        ]
      })
    },
    evolution: {
      evidencePatterns: [
        readJson('fixtures/police-family/evolution/positive-recurring-regression.json').input.evidencePatterns[0]
      ]
    },
    polymorph: readJson('fixtures/police-family/polymorph/positive-template-drift.json').input,
    rollback: readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input,
    evidenceIntegrity: readJson('fixtures/police-family/shared-gates/positive-evidence-integrity-clean.json').input,
    reversibility: { proposals: readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input.proposals },
    noiseControl: { findings: [] }
  });

  check(positiveGateReport.schemaId === 'atm.policeFamilyGateReport', 'gate report schemaId must be atm.policeFamilyGateReport');
  check(positiveGateReport.specVersion === '0.1.0', 'gate report specVersion must be 0.1.0');
  check(positiveGateReport.profile === 'standard', 'gate report profile must be standard');
  check(positiveGateReport.families.length >= 14, `gate report must include >=14 families (got ${positiveGateReport.families.length})`);
  check(Array.isArray(positiveGateReport.sharedGates), 'gate report must include sharedGates array');
  check(positiveGateReport.sharedGates!.length === 3, `gate report must include 3 shared gates (got ${positiveGateReport.sharedGates?.length ?? 0})`);
  for (const gateName of ['evidence-integrity', 'reversibility', 'noise-control'] as const) {
    const gate = positiveGateReport.sharedGates!.find((g) => g.gate === gateName);
    check(gate !== undefined, `shared gate ${gateName} must be present`);
    check(gate?.sourceValidator?.startsWith('run'), `shared gate ${gateName} must use a named runner`);
  }
  check(Array.isArray(positiveGateReport.findings), 'findings must be an array');
  check(Array.isArray(positiveGateReport.blockingFindings), 'blockingFindings must be an array');
  check(Array.isArray(positiveGateReport.advisoryFindings), 'advisoryFindings must be an array');

  const blockerFamilies = positiveGateReport.families.filter((family) => family.mode === 'blocker');
  const advisoryFamilies = positiveGateReport.families.filter((family) => family.mode === 'advisory');
  check(blockerFamilies.length >= 6, 'gate must have >=6 blocker families (schema, dep-graph, boundary, registry, lifecycle, quality)');
  check(advisoryFamilies.length === 8, 'gate must have 8 advisory families (dedup, demand, map-integration, atomization, decomposition, evolution, polymorph, rollback)');

  for (const familyName of ['dedup', 'demand', 'quality', 'map-integration', 'atomization', 'decomposition', 'evolution', 'polymorph', 'rollback']) {
    const family = positiveGateReport.families.find((entry) => entry.family === familyName);
    check(family !== undefined, `${familyName} family must be present in gate report`);
    check(family?.sourceValidator?.startsWith('run'), `${familyName} family must use named runtime scanner`);
  }

  const negativeCoreFamilies = buildCoreFamilies({
    mapFixture: readJson(fixture.dependencyGraph.negativePath),
    layerPolicy: readJson(fixture.layerBoundary.policyPath),
    importGraph: readJson(fixture.layerBoundary.positivePath),
    registryGate: readJson(fixture.registryGate.positivePath),
    lifecycleInput: readJson(fixture.lifecyclePolice.positivePath)
  });
  const negativeGateReport = buildPoliceFamilyGateReport({
    profile: 'standard',
    families: [
      ...negativeCoreFamilies,
      dedupFamily,
      demandFamily,
      qualityDedupFamily,
      mapFamily,
      atomizationPassFamily
    ]
  });
  check(negativeGateReport.ok === false, 'gate must report ok=false when dependency cycle exists');
  check(
    negativeGateReport.blockingFindings.some((finding) => finding.policeFamily === 'dependency-graph'),
    'negative gate must produce dependency-graph blocking finding'
  );

  const lifecycleHardFailFamilies = buildCoreFamilies({
    mapFixture: readJson(fixture.dependencyGraph.positivePath),
    layerPolicy: readJson(fixture.layerBoundary.policyPath),
    importGraph: readJson(fixture.layerBoundary.positivePath),
    registryGate: readJson(fixture.registryGate.positivePath),
    lifecycleInput: readJson(fixture.lifecyclePolice.negativeProductionPath)
  });
  const lifecycleFamily = lifecycleHardFailFamilies.find((family) => family.family === 'lifecycle');
  check(lifecycleFamily?.status === 'fail', 'lifecycle family must fail when hardFail=true');
  check(lifecycleFamily?.findings.some((finding) => finding.action === 'hard-fail' || finding.action === 'quarantine'), 'lifecycle hard-fail must produce privileged lifecycle finding');

  const quarantineFixture = readJson('fixtures/police-family/negative-non-lifecycle-quarantine.json');
  check(quarantineFixture.finding.policeFamily !== 'lifecycle', 'quarantine fixture must be non-lifecycle');
  check(quarantineFixture.finding.action === 'quarantine', 'quarantine fixture must attempt quarantine');
  check(quarantineFixture.expected.quarantineMustBeRejected === true, 'non-lifecycle quarantine must be rejected');
  check(
    [...dedupFamily.findings, ...demandFamily.findings, ...qualityDedupFamily.findings, ...mapFamily.findings, ...atomizationPassFamily.findings]
      .every((finding) => finding.action !== 'quarantine'),
    'non-lifecycle police families must not produce quarantine actions'
  );

  const policeMachineFinding = toReviewAdvisoryMachineFinding(qualityRegressionFamily.findings[0]);
  const stubReport = createStubReviewAdvisoryReport({
    profile: 'pass',
    reportId: 'review-advisory.police-family.bridge-test',
    target: { kind: 'scope', id: 'police-family-gate' }
  });
  const bridgedReport = appendMachineFindings(stubReport, [policeMachineFinding]);
  const bridgedFinding = bridgedReport.findings.find((finding: any) => finding.id === policeMachineFinding.id);
  check(bridgedFinding?.trigger === 'machine-finding', 'bridged report must contain machine-finding trigger');
  check(bridgedFinding?.metadata?.policeFinding !== undefined, 'ReviewAdvisory bridge must preserve metadata.policeFinding');
  check(bridgedFinding?.action === 'request-human-review', 'high/block police finding must request human review');
  check(bridgedReport.needsReview === true, 'high severity police finding must route to needsReview=true');

  const advisoryMachineFinding = toReviewAdvisoryMachineFinding(dedupFamily.findings[0]);
  const advisoryBridgedReport = appendMachineFindings(stubReport, [advisoryMachineFinding]);
  const advisoryBridgedFinding = advisoryBridgedReport.findings.find((finding: any) => finding.id === advisoryMachineFinding.id);
  check(advisoryBridgedFinding?.metadata?.policeFinding !== undefined, 'advisory police finding must preserve metadata.policeFinding');
  check(advisoryBridgedFinding?.action === 'needs-review', 'advisory police finding must not auto-approve');

  const payloadFixture = readJson('fixtures/police-family/negative-payload-as-current-contract.json');
  check('payload' in payloadFixture.finding, 'payload negative fixture must contain payload field');
  check(payloadFixture.expected.payloadMustBeRejected === true, 'payload-as-contract must be rejected');
  const normalizedNoPayload: Partial<PoliceFinding> = {
    findingId: payloadFixture.finding.findingId,
    policeFamily: payloadFixture.finding.policeFamily,
    severity: payloadFixture.finding.severity,
    message: payloadFixture.finding.message
  };
  check(!('payload' in normalizedNoPayload), 'normalized PoliceFinding must strip payload field');

  const bypassFixture = readJson('fixtures/police-family/negative-advisory-bypasses-human-review.json');
  check(bypassFixture.expected.directApprovalMustBeRejected === true, 'advisory bypass must be rejected');
  check(bypassFixture.decision?.status === 'approved', 'bypass fixture must attempt direct approval');
  check(bypassFixture.finding.action === 'none', 'advisory action=none cannot auto-approve');

  const privatePathFixture = readJson('fixtures/police-family/negative-private-path-in-upstream-finding.json');
  check(privatePathFixture.expected.privatePathMustBeRejected === true, 'private path must be rejected');
  const privateBannedPatterns = privatePathFixture.expected.bannedPatterns ?? ['adopter-local', 'private-registry'];
  const hasPrivatePath = privatePathFixture.finding.evidenceRefs?.some(
    (ref: string) => privateBannedPatterns.some((pattern: string) => ref.includes(pattern))
  );
  check(hasPrivatePath, 'negative fixture must demonstrate adopter-local path');

  const requiredFiles = [
    'packages/core/src/police/family.ts',
    'packages/cli/src/commands/police.ts',
    'scripts/validate-police-family.ts',
    'fixtures/police-family/positive-police-machine-finding.json',
    'fixtures/police-family/positive-advisory-finding.json',
    'fixtures/police-family/positive-blocking-finding.json',
    'fixtures/police-family/positive-evidence-refs-split.json',
    'fixtures/police-family/negative-payload-as-current-contract.json',
    'fixtures/police-family/negative-non-lifecycle-quarantine.json',
    'fixtures/police-family/negative-advisory-bypasses-human-review.json',
    'fixtures/police-family/negative-private-path-in-upstream-finding.json'
  ];

  for (const relativePath of requiredFiles) {
    check(existsSync(path.join(root, relativePath)), `required file missing: ${relativePath}`);
  }

  const policeCliSource = readText('packages/cli/src/commands/police.ts');
  check(policeCliSource.includes('runPoliceFamilyGate'), 'atm police CLI must call runPoliceFamilyGate');
  check(policeCliSource.includes('--profile'), 'atm police CLI must support --profile');
  check(policeCliSource.includes('--out'), 'atm police CLI must support --out');

  const protectedPoliceFamilyFiles = [
    'packages/core/src/police/family.ts',
    'scripts/validate-police-family.ts',
    'fixtures/police-family/positive-police-machine-finding.json',
    'fixtures/police-family/positive-advisory-finding.json',
    'fixtures/police-family/positive-blocking-finding.json',
    'fixtures/police-family/positive-evidence-refs-split.json'
  ];

  const bannedProtectedSurfaceTerms = [
    ['3K', 'Life'].join(''),
    ['Co', 'cos'].join(''),
    ['html', '-to-', 'ucuf'].join(''),
    ['ga', 'cha'].join(''),
    ['UC', 'UF'].join(''),
    ['task', '-lock'].join(''),
    ['compute', '-gate'].join(''),
    ['doc', '-id-', 'registry'].join(''),
    ['tools', '_node/'].join(''),
    ['assets', '/scripts/'].join(''),
    ['docs', '/agent-', 'briefs/'].join('')
  ];

  for (const relativePath of protectedPoliceFamilyFiles) {
    if (existsSync(path.join(root, relativePath))) {
      const content = readText(relativePath);
      for (const term of bannedProtectedSurfaceTerms) {
        check(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
      }
    }
  }

  return { positiveGateReport, blockerFamilies, advisoryFamilies, stubReport };
}
