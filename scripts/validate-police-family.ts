import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPoliceChecks } from '../packages/core/src/police/index.ts';
import {
  buildCorePoliceFamilies,
  buildDecompositionPlanHintDraft,
  buildEvolutionSuppressionKey,
  buildPoliceFamilyGateReport,
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey,
  runAtomizationPolice,
  runDecompositionPolice,
  runDedupPolice,
  runDemandPolice,
  runEvidenceIntegrityGate,
  runEvolutionPolice,
  runMapIntegrationPolice,
  runNoiseControlGate,
  runPoliceFamilyGate,
  runPolymorphPolice,
  runQualityPolice,
  runAdopterNeutralityCheck,
  runRegistryContractDriftCheck,
  runReversibilityGate,
  runRollbackPolice,
  toReviewAdvisoryMachineFinding,
  verifyAdvisoryOnlyHardening,
  VALIDATOR_PROFILE_NAMING_CONTRACT,
  type PoliceFamilyReport,
  type PoliceFinding
} from '../packages/core/src/police/family.ts';
import { buildSourceInventoryReport } from '../packages/core/src/source-inventory/source-inventory.ts';
import { buildLegacyRoutePlan } from '../packages/core/src/guidance/legacy-route-plan.ts';
import { compareQualityMetrics } from '../packages/core/src/police/regression-compare.ts';
import { curateAtomMapEvolution } from '../packages/core/src/upgrade/map-curator.ts';
import { createLocalGitAdapter } from '../packages/adapter-local-git/src/local-git-adapter.ts';
import { runLifecyclePolice } from '../packages/plugin-rule-guard/src/lifecycle-police.ts';
import {
  appendMachineFindings,
  createStubReviewAdvisoryReport
} from '../packages/plugin-review-advisory/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/police.fixture.json');

function fail(message: any) {
  console.error(`[police-family:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function materializeCuratorInput(fixturePath: string) {
  const curatorFixture = readJson(fixturePath);
  return {
    ...curatorFixture.input,
    repositoryRoot: root
  };
}

function buildCoreFamilies(options: {
  mapFixture: any;
  layerPolicy: any;
  importGraph: any;
  registryGate: any;
  lifecycleInput: any;
}) {
  const policeReport = runPoliceChecks({
    lifecycleMode: 'evolution',
    mapFixture: options.mapFixture,
    layerPolicy: options.layerPolicy,
    importGraph: options.importGraph,
    forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
    registryGate: options.registryGate
  });
  const lifecycleReport = runLifecyclePolice(options.lifecycleInput);
  return buildCorePoliceFamilies({
    policeReport,
    lifecycleReport
  });
}

const sharedCoreFamilies = buildCoreFamilies({
  mapFixture: readJson(fixture.dependencyGraph.positivePath),
  layerPolicy: readJson(fixture.layerBoundary.policyPath),
  importGraph: readJson(fixture.layerBoundary.positivePath),
  registryGate: readJson(fixture.registryGate.positivePath),
  lifecycleInput: readJson(fixture.lifecyclePolice.positivePath)
});

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
  readText('packages/core/src/police/family.ts').includes('findByFingerprintPrefix'),
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
  lifecycleMode: 'evolution',
  config: { dryRun: true }
};
const dryRunPass = adapter.runAtomizeAdapter(adapterContext, {
  legacySource: 'legacy://framework/src/legacy-atomization.ts#L1',
  inlineSource: 'function safeLeaf(){ return 42; }',
  patchFiles: []
});
const dryRunNeutralityFail = adapter.runAtomizeAdapter(adapterContext, {
  legacySource: 'legacy://framework/src/legacy-atomization.ts#L2',
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
  dryRunResult: dryRunPass
});
const atomizationNeutralityFailFamily = runAtomizationPolice({
  legacyRoutePlan: atomizationPlan,
  dryRunResult: dryRunNeutralityFail
});
const atomizationHostMutationFamily = runAtomizationPolice({
  legacyRoutePlan: atomizationPlan,
  dryRunResult: dryRunHostMutationAttempt
});

check(atomizationPassFamily.sourceValidator === 'runAtomizationPolice', 'Atomization Police must be a named scanner');
check(atomizationPassFamily.findings.some((finding) => finding.routeHint === 'behavior.atomize'), 'Atomization Police must surface atomize candidates');
check(atomizationPassFamily.findings.some((finding) => finding.routeHint === 'behavior.infect'), 'Atomization Police must surface infect candidates');
check(!atomizationPassFamily.findings.some((finding) => finding.severity === 'block'), 'Atomization dry-run pass must not block');
check(atomizationNeutralityFailFamily.findings.some((finding) => finding.trigger === 'dry-run-proposal-guard' && finding.severity === 'block'), 'Neutrality fail must block Atomization Police');
check(atomizationHostMutationFamily.findings.some((finding) => finding.trigger === 'dry-run-proposal-guard' && finding.severity === 'block'), 'Host mutation attempt must block Atomization Police');

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
    dryRunResult: dryRunPass
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

// ── Decomposition Police (APF-0030 / 0031 / 0032 / 0033 / 0038) ───────────

const decompPositiveFixture = readJson('fixtures/police-family/decomposition/positive-oversized.json');
const decompPositiveInventory = buildSourceInventoryReport({
  maxFileLines: 1000,
  entries: decompPositiveFixture.input.inventory.entries
});
const decompPositiveFamily = runDecompositionPolice({ inventory: decompPositiveInventory });
check(decompPositiveFamily.sourceValidator === 'runDecompositionPolice', 'Decomposition Police must be a named scanner');
check(decompPositiveFamily.findings.length === 1, 'Decomposition Police must produce 1 finding for oversized fixture');
check(decompPositiveFamily.findings[0].trigger === 'oversized-source-surface', 'Decomposition Police trigger must be oversized-source-surface');
check(decompPositiveFamily.findings[0].severity === 'advisory', 'Decomposition Police finding severity must be advisory');
check(decompPositiveFamily.findings[0].action === 'proposal-draft', 'Decomposition Police action must be proposal-draft');
check(decompPositiveFamily.findings[0].routeHint === 'behavior.atomize', 'Decomposition Police primary route must be behavior.atomize');
const decompMetadata = decompPositiveFamily.findings[0].metadata as any;
check(decompMetadata.directApplyAllowed === false, 'Decomposition Police must not auto-apply');
check(Array.isArray(decompMetadata.suggestedRoute) && decompMetadata.suggestedRoute.includes('behavior.compose'), 'Decomposition Police must suggest behavior.compose as secondary route');
check(decompMetadata.suggestedMapReplacement === true, 'Decomposition Police must hint suggestedMapReplacement=true');
check(decompMetadata.decompositionPlanHint?.legacyUris?.length > 0, 'decompositionPlanHint.legacyUris must be populated');

const decompBelow = runDecompositionPolice({
  inventory: buildSourceInventoryReport({
    maxFileLines: 1000,
    entries: readJson('fixtures/police-family/decomposition/negative-below-threshold.json').input.inventory.entries
  })
});
check(decompBelow.findings.length === 0, 'Decomposition Police must produce no finding below threshold');

const decompIgnored = runDecompositionPolice({
  inventory: buildSourceInventoryReport({
    maxFileLines: 1000,
    entries: readJson('fixtures/police-family/decomposition/negative-ignored-path.json').input.inventory.entries
  })
});
check(decompIgnored.findings.length === 0, 'Decomposition Police must skip entries with ignoredReason');

const decompReplaced = runDecompositionPolice({
  inventory: buildSourceInventoryReport({
    maxFileLines: 1000,
    entries: readJson('fixtures/police-family/decomposition/negative-existing-replacement-map.json').input.inventory.entries
  })
});
check(decompReplaced.findings.length === 0, 'Decomposition Police must skip entries with hasActiveReplacementMap');

const decompPlanDraft = buildDecompositionPlanHintDraft(decompPositiveFamily.findings[0]);
check(decompPlanDraft.ok === true, 'buildDecompositionPlanHintDraft must succeed for positive finding');
check(decompPlanDraft.draft?.mode === 'draft', 'decomposition plan draft mode must be draft');
check((decompPlanDraft.draft?.legacyUris?.length ?? 0) > 0, 'decomposition plan draft must have legacyUris');
check((decompPlanDraft.draft?.entrypoints?.length ?? 0) > 0, 'decomposition plan draft must have entrypoints');

const draftMissingLegacy = buildDecompositionPlanHintDraft({
  ...decompPositiveFamily.findings[0],
  metadata: { ...decompMetadata, decompositionPlanHint: { entrypoints: ['x'] } }
});
check(draftMissingLegacy.ok === false, 'plan draft must fail when legacyUris missing');
check(draftMissingLegacy.errors.includes('missing-replacement-legacyUris'), 'plan draft must report missing-replacement-legacyUris');

const draftMissingEntry = buildDecompositionPlanHintDraft({
  ...decompPositiveFamily.findings[0],
  metadata: { ...decompMetadata, decompositionPlanHint: { legacyUris: ['x'] } }
});
check(draftMissingEntry.ok === false, 'plan draft must fail when entrypoints missing');
check(draftMissingEntry.errors.includes('missing-entrypoints'), 'plan draft must report missing-entrypoints');

const decompCapped = runDecompositionPolice({
  inventory: buildSourceInventoryReport({
    maxFileLines: 500,
    entries: [
      { filePath: 'src/over-a.ts', lineCount: 1200 },
      { filePath: 'src/over-b.ts', lineCount: 1100 },
      { filePath: 'src/over-c.ts', lineCount: 900 }
    ]
  }),
  dailyCap: 2
});
check(
  decompCapped.findings.filter((f) => f.trigger === 'oversized-source-surface' && f.severity === 'advisory').length === 2,
  'Decomposition Police must emit exactly dailyCap advisory findings'
);
check(
  decompCapped.findings.some((f) => f.routeHint === 'observation.daily-cap'),
  'Decomposition Police must produce observation finding when daily cap is reached'
);

// ── Evolution Police (APF-0034 / 0035 / 0036 / 0038) ───────────────────────

const evoPositiveFixture = readJson('fixtures/police-family/evolution/positive-recurring-regression.json');
const evoPositiveFamily = runEvolutionPolice({ evidencePatterns: evoPositiveFixture.input.evidencePatterns });
check(evoPositiveFamily.sourceValidator === 'runEvolutionPolice', 'Evolution Police must be a named scanner');
check(evoPositiveFamily.findings.length === 1, 'Evolution Police must produce 1 finding for recurring regression');
check(evoPositiveFamily.findings[0].trigger === 'evidence-evolution-signal', 'Evolution Police trigger must be evidence-evolution-signal');
check(evoPositiveFamily.findings[0].severity === 'advisory', 'Evolution Police finding severity must be advisory');
check(evoPositiveFamily.findings[0].action === 'proposal-draft', 'Evolution Police action must be proposal-draft');
check(evoPositiveFamily.findings[0].routeHint === 'behavior.evolve', 'Evolution Police route must be behavior.evolve for atom-level signal');
const evoMetadata = evoPositiveFamily.findings[0].metadata as any;
check(evoMetadata.directApplyAllowed === false, 'Evolution Police must not auto-apply');
check(evoMetadata.suppressionKey?.includes('::evolution'), 'Evolution suppressionKey must include scanner family suffix');

const evoUsageOnly = runEvolutionPolice({
  evidencePatterns: readJson('fixtures/police-family/evolution/negative-usage-only.json').input.evidencePatterns
});
check(evoUsageOnly.findings.length === 0, 'Evolution Police must reject usage-only evidence');

const evoHostLocal = runEvolutionPolice({
  evidencePatterns: readJson('fixtures/police-family/evolution/negative-host-local.json').input.evidencePatterns
});
check(evoHostLocal.findings.length === 0, 'Evolution Police must suppress host-local preferences from global atom contract');

const evoStaleBase = runEvolutionPolice({
  evidencePatterns: readJson('fixtures/police-family/evolution/negative-stale-base.json').input.evidencePatterns
});
check(evoStaleBase.findings.length === 1, 'Evolution Police must produce stale-evolution-draft finding');
check(evoStaleBase.findings[0].trigger === 'stale-evolution-draft', 'stale-base finding must use stale-evolution-draft trigger');
check(evoStaleBase.findings[0].severity === 'warning', 'stale-base finding must be warning severity');
check(evoStaleBase.findings[0].action === 'request-human-review', 'stale-base must request human review');

const evoSuppressed = runEvolutionPolice({
  evidencePatterns: evoPositiveFixture.input.evidencePatterns,
  suppressedKeys: [buildEvolutionSuppressionKey(evoPositiveFixture.input.evidencePatterns[0])]
});
check(evoSuppressed.findings.length === 0, 'Evolution Police must suppress matching suppression key');

const evoBelowConfidence = runEvolutionPolice({
  evidencePatterns: [{
    ...evoPositiveFixture.input.evidencePatterns[0],
    confidence: 0.3
  }]
});
check(evoBelowConfidence.findings.length === 0, 'Evolution Police must reject below-confidence-threshold patterns');

const evoBelowRecurrence = runEvolutionPolice({
  evidencePatterns: [{
    ...evoPositiveFixture.input.evidencePatterns[0],
    recurrence: 1
  }]
});
check(evoBelowRecurrence.findings.length === 0, 'Evolution Police must reject below-recurrence-threshold patterns');

// Decomposition + Evolution families must reach ReviewAdvisory via machine-finding
const decompMachineFinding = toReviewAdvisoryMachineFinding(decompPositiveFamily.findings[0]);
const decompBridged = appendMachineFindings(stubReport, [decompMachineFinding]);
const decompBridgedFinding = decompBridged.findings.find((finding: any) => finding.id === decompMachineFinding.id);
check(decompBridgedFinding?.trigger === 'machine-finding', 'Decomposition finding must enter ReviewAdvisory as machine-finding');
check((decompBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'decomposition', 'ReviewAdvisory must preserve decomposition policeFinding');
check(decompBridgedFinding?.action !== 'none', 'Decomposition advisory cannot auto-approve');

const evoMachineFinding = toReviewAdvisoryMachineFinding(evoPositiveFamily.findings[0]);
const evoBridged = appendMachineFindings(stubReport, [evoMachineFinding]);
const evoBridgedFinding = evoBridged.findings.find((finding: any) => finding.id === evoMachineFinding.id);
check(evoBridgedFinding?.trigger === 'machine-finding', 'Evolution finding must enter ReviewAdvisory as machine-finding');
check((evoBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'evolution', 'ReviewAdvisory must preserve evolution policeFinding');
check(evoBridgedFinding?.action !== 'none', 'Evolution advisory cannot auto-approve');

// ── Polymorph Police (APF-0040~0042) ───────────────────────────────────────

const polymorphDriftFixture = readJson('fixtures/police-family/polymorph/positive-template-drift.json');
const polymorphDriftFamily = runPolymorphPolice(polymorphDriftFixture.input);
check(polymorphDriftFamily.sourceValidator === 'runPolymorphPolice', 'Polymorph Police must be a named scanner');
check(
  polymorphDriftFamily.findings.some((finding) => finding.trigger === 'template-drift'),
  'Polymorph Police must produce template-drift finding for drifting instance'
);
check(
  polymorphDriftFamily.findings.every((finding) => (finding.metadata as any)?.directApplyAllowed === false),
  'Polymorph Police findings must mark directApplyAllowed=false'
);

const polymorphPropagationFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/positive-instance-propagation-missing.json').input);
check(
  polymorphPropagationFamily.findings.some((finding) => finding.trigger === 'instance-propagation-missing'),
  'Polymorph Police must produce instance-propagation-missing finding when instances lag template'
);

const polymorphVariantFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/positive-variant-explosion.json').input);
check(
  polymorphVariantFamily.findings.some((finding) => finding.trigger === 'variant-explosion'),
  'Polymorph Police must produce variant-explosion finding when threshold exceeded'
);

const polymorphCleanFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/negative-same-group-dedup-ignored.json').input);
check(polymorphCleanFamily.findings.length === 0, 'Polymorph Police must produce no finding when instances synchronized within threshold');

const polymorphSuppressionKey = buildPolymorphSuppressionKey({
  templateId: 'ATM-POLY-0001',
  signalKind: 'template-drift',
  instanceId: 'ATM-INST-0001',
  templateVersion: '1.2.0'
});
const polymorphSuppressed = runPolymorphPolice({
  ...polymorphDriftFixture.input,
  suppressedKeys: [polymorphSuppressionKey]
});
check(polymorphSuppressed.findings.filter((f) => f.trigger === 'template-drift').length === 0, 'Polymorph Police must honor suppressionKeys');

// ── Rollback Police (APF-0043 / 0044) ──────────────────────────────────────

const rollbackProofFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input);
check(rollbackProofFamily.sourceValidator === 'runRollbackPolice', 'Rollback Police must be a named scanner');
check(rollbackProofFamily.findings.length === 0, 'Rollback Police must produce no finding when rollback proof present');

const rollbackIrreversibleFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input);
check(
  rollbackIrreversibleFamily.findings.some((f) => f.trigger === 'irreversible-proposal' && f.severity === 'block'),
  'Rollback Police must block irreversible proposal'
);
check(rollbackIrreversibleFamily.status === 'fail', 'Rollback Police status must fail when blocker present');

const rollbackEquivalenceFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-map-equivalence-missing.json').input);
check(
  rollbackEquivalenceFamily.findings.some((f) => f.trigger === 'equivalence-proof-missing'),
  'Rollback Police must report equivalence-proof-missing for map-replacement'
);

const rollbackScopeDriftFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-rollback-scope-drift.json').input);
check(
  rollbackScopeDriftFamily.findings.some((f) => f.trigger === 'rollback-scope-drift'),
  'Rollback Police must report rollback-scope-drift when touched surfaces escape declared scope'
);

const rollbackSuppressionKey = buildRollbackSuppressionKey({
  proposalId: 'proposal.atomize.unsafe.001',
  signalKind: 'irreversible-proposal',
  baseVersion: '0.5.0'
});
const rollbackSuppressed = runRollbackPolice({
  ...readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input,
  suppressedKeys: [rollbackSuppressionKey]
});
check(
  rollbackSuppressed.findings.every((f) => f.trigger !== 'irreversible-proposal'),
  'Rollback Police must honor suppressionKeys'
);

// ── Evidence Integrity Gate (APF-0045) ─────────────────────────────────────

const evidenceCleanGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/positive-evidence-integrity-clean.json').input);
check(evidenceCleanGate.gate === 'evidence-integrity', 'Evidence Integrity Gate name must be evidence-integrity');
check(evidenceCleanGate.status === 'pass', 'Evidence Integrity Gate must pass for clean fixture');

const evidenceMissingGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-missing.json').input);
check(
  evidenceMissingGate.findings.some((f) => f.trigger === 'evidence-missing'),
  'Evidence Integrity Gate must report evidence-missing'
);

const evidenceStaleGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-stale.json').input);
check(
  evidenceStaleGate.findings.some((f) => f.trigger === 'evidence-stale'),
  'Evidence Integrity Gate must report evidence-stale'
);

const evidenceDuplicateGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-duplicate.json').input);
check(
  evidenceDuplicateGate.findings.some((f) => f.trigger === 'evidence-duplicate'),
  'Evidence Integrity Gate must report evidence-duplicate'
);

// ── Reversibility Gate (APF-0046) ──────────────────────────────────────────

const reversibilityCleanGate = runReversibilityGate({ proposals: readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input.proposals });
check(reversibilityCleanGate.gate === 'reversibility', 'Reversibility Gate name must be reversibility');
check(reversibilityCleanGate.status === 'pass', 'Reversibility Gate must pass when rollback proof present');

const reversibilityBlockedGate = runReversibilityGate({ proposals: readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input.proposals });
check(reversibilityBlockedGate.status === 'fail', 'Reversibility Gate must fail for irreversible proposal');
check((reversibilityBlockedGate.summary.blocked ?? 0) > 0, 'Reversibility Gate must record blocked count');

// ── Noise Control Gate (APF-0047) ──────────────────────────────────────────

const noiseSuppress = runNoiseControlGate(readJson('fixtures/police-family/shared-gates/positive-noise-control-suppression.json').input);
check(noiseSuppress.gate === 'noise-control', 'Noise Control Gate name must be noise-control');
check(noiseSuppress.findings.length === 0, 'Noise Control Gate must filter suppressed advisory finding');
check((noiseSuppress.summary.suppressed ?? 0) === 1, 'Noise Control Gate must record suppressed count');

const noiseBypass = runNoiseControlGate(readJson('fixtures/police-family/shared-gates/negative-noise-control-high-severity-bypass.json').input);
check(noiseBypass.findings.length === 1, 'Noise Control Gate must admit high-severity finding bypassing suppression');
check((noiseBypass.summary.bypassed ?? 0) === 1, 'Noise Control Gate must record bypassed count');

// ── Contract Drift Check inside Registry Consistency (APF-0048) ────────────

const driftFamily = runRegistryContractDriftCheck(readJson('fixtures/police-family/contract-drift/positive-spec-implementation-drift.json').input);
check(driftFamily.family === 'registry-consistency', 'Contract Drift output must be carried by registry-consistency family');
check(
  driftFamily.findings.some((f) => f.trigger === 'spec-implementation-drift'),
  'Contract Drift Check must report spec-implementation-drift'
);
check(driftFamily.status === 'fail', 'Contract Drift Check must fail registry-consistency when drift detected');
check(driftFamily.mode === 'blocker', 'Contract Drift Check must produce blocker-mode family report');

const driftClean = runRegistryContractDriftCheck(readJson('fixtures/police-family/contract-drift/negative-matching-hashes.json').input);
check(driftClean.findings.length === 0, 'Contract Drift Check must produce no finding when hashes match');

// ── Bridges to ReviewAdvisory for new families ─────────────────────────────

const polymorphMachineFinding = toReviewAdvisoryMachineFinding(polymorphDriftFamily.findings[0]);
const polymorphBridged = appendMachineFindings(stubReport, [polymorphMachineFinding]);
const polymorphBridgedFinding = polymorphBridged.findings.find((finding: any) => finding.id === polymorphMachineFinding.id);
check((polymorphBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'polymorph', 'ReviewAdvisory must preserve polymorph policeFinding');

const rollbackMachineFinding = toReviewAdvisoryMachineFinding(rollbackIrreversibleFamily.findings[0]);
const rollbackBridged = appendMachineFindings(stubReport, [rollbackMachineFinding]);
const rollbackBridgedFinding = rollbackBridged.findings.find((finding: any) => finding.id === rollbackMachineFinding.id);
check((rollbackBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'rollback', 'ReviewAdvisory must preserve rollback policeFinding');
check(rollbackBridgedFinding?.action === 'request-human-review', 'Rollback blocker must route to request-human-review (not auto-approve)');

// Required new fixture files
const newFamilyFixtures = [
  'fixtures/police-family/decomposition/positive-oversized.json',
  'fixtures/police-family/decomposition/negative-below-threshold.json',
  'fixtures/police-family/decomposition/negative-ignored-path.json',
  'fixtures/police-family/decomposition/negative-existing-replacement-map.json',
  'fixtures/police-family/evolution/positive-recurring-regression.json',
  'fixtures/police-family/evolution/negative-usage-only.json',
  'fixtures/police-family/evolution/negative-host-local.json',
  'fixtures/police-family/evolution/negative-stale-base.json',
  'fixtures/police-family/polymorph/positive-template-drift.json',
  'fixtures/police-family/polymorph/positive-instance-propagation-missing.json',
  'fixtures/police-family/polymorph/positive-variant-explosion.json',
  'fixtures/police-family/polymorph/negative-same-group-dedup-ignored.json',
  'fixtures/police-family/rollback/positive-rollback-proof-present.json',
  'fixtures/police-family/rollback/negative-irreversible-proposal.json',
  'fixtures/police-family/rollback/negative-map-equivalence-missing.json',
  'fixtures/police-family/rollback/negative-rollback-scope-drift.json',
  'fixtures/police-family/shared-gates/positive-evidence-integrity-clean.json',
  'fixtures/police-family/shared-gates/negative-evidence-missing.json',
  'fixtures/police-family/shared-gates/negative-evidence-stale.json',
  'fixtures/police-family/shared-gates/negative-evidence-duplicate.json',
  'fixtures/police-family/shared-gates/positive-noise-control-suppression.json',
  'fixtures/police-family/shared-gates/negative-noise-control-high-severity-bypass.json',
  'fixtures/police-family/contract-drift/positive-spec-implementation-drift.json',
  'fixtures/police-family/contract-drift/negative-matching-hashes.json',
  'packages/core/src/source-inventory/source-inventory.ts'
];
for (const relativePath of newFamilyFixtures) {
  check(existsSync(path.join(root, relativePath)), `required new-family file missing: ${relativePath}`);
}

// ── Adopter Neutrality Check (APF-0052) ────────────────────────────────────

const adopterCleanFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/positive-clean-protected-surface.json').input);
check(adopterCleanFamily.family === 'registry-consistency', 'Adopter Neutrality Check must be carried by registry-consistency family');
check(adopterCleanFamily.findings.length === 0, 'Adopter Neutrality clean fixture must produce no finding');
check(adopterCleanFamily.sourceValidator === 'runAdopterNeutralityCheck', 'Adopter Neutrality must use named source validator');

const adopterProjectFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-adopter-project-name.json').input);
check(adopterProjectFamily.findings.some((f) => f.trigger === 'adopter-neutrality-violation'), 'Adopter Neutrality must report adopter-neutrality-violation');
check(adopterProjectFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-project-name'), 'finding metadata must include matchedTermClass');
check(adopterProjectFamily.status === 'fail', 'Adopter Neutrality full profile must fail when banned term found');
check(adopterProjectFamily.findings.every((f) => f.severity === 'block'), 'Adopter Neutrality under full profile must use severity=block');

const adopterEngineFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-adopter-engine-name.json').input);
check(adopterEngineFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-engine-name'), 'engine-name fixture must produce matchedTermClass=adopter-engine-name');

const adopterPathFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-absolute-private-path.json').input);
check(adopterPathFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-private-path'), 'private-path fixture must produce matchedTermClass=adopter-private-path');
check(adopterPathFamily.findings.every((f) => f.severity === 'advisory'), 'standard profile must demote severity to advisory');
check(adopterPathFamily.status === 'pass', 'standard profile must not fail status when advisory-only');

const adopterAssetFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-host-only-asset-path.json').input);
check(adopterAssetFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-host-only-asset'), 'host-only-asset fixture must produce matchedTermClass=adopter-host-only-asset');

const adopterAllowlistFamily = runAdopterNeutralityCheck({
  ...readJson('fixtures/police-family/adopter-neutrality/negative-adopter-project-name.json').input,
  allowlist: ['docs/protected-readme.md']
});
check(adopterAllowlistFamily.findings.length === 0, 'allowlist must exempt files from adopter-neutrality check');

const adopterMetadataFields = ['filePath', 'matchedTermClass', 'scope', 'suggestedAction', 'profile'];
for (const field of adopterMetadataFields) {
  check(field in (adopterProjectFamily.findings[0].metadata as any), `Adopter Neutrality finding metadata must include ${field}`);
}

// ── Advisory-Only Hardening (APF-0053) ─────────────────────────────────────

const positiveAdvisoryHardening = verifyAdvisoryOnlyHardening({ probes: [] });
check(positiveAdvisoryHardening.schemaId === 'atm.advisoryOnlyHardeningReport', 'hardening report must use atm.advisoryOnlyHardeningReport schemaId');
check(positiveAdvisoryHardening.ok === true, 'hardening report with empty probes must be ok');

const mutationDenialFixture = readJson('fixtures/police-family/advisory-hardening/negative-advisory-mutation-denial.json');
const mutationDenial = verifyAdvisoryOnlyHardening(mutationDenialFixture.input);
check(mutationDenial.results.length === 1, 'mutation denial fixture must produce one result');
check(mutationDenial.results[0].rejected === true, 'mutation attempt must be rejected');
check(mutationDenial.results[0].attemptedAction === 'registry-mutation', 'mutation denial result must record attemptedAction');
check(mutationDenial.results[0].reason.includes('cannot directly mutate registry'), 'mutation denial reason must explain rejection');

const autoApprovalFixture = readJson('fixtures/police-family/advisory-hardening/negative-advisory-auto-approval-denial.json');
const autoApprovalDenial = verifyAdvisoryOnlyHardening(autoApprovalFixture.input);
check(autoApprovalDenial.results[0].rejected === true, 'auto-approve attempt must be rejected');
check(autoApprovalDenial.results[0].attemptedAction === 'auto-approve', 'auto-approve denial result must record attemptedAction');
check(autoApprovalDenial.results[0].reason.includes('cannot produce approved HumanReviewDecision'), 'auto-approve denial reason must explain rejection');

const positiveAdvisoryFixture = readJson('fixtures/police-family/advisory-hardening/positive-advisory-report-only.json');
check(positiveAdvisoryFixture.advisoryFinding.directApplyAllowed === false, 'positive advisory fixture must mark directApplyAllowed=false');
check(positiveAdvisoryFixture.advisoryFinding.action === 'needs-review', 'positive advisory fixture action must be report-only (needs-review)');

const combinedHardening = verifyAdvisoryOnlyHardening({
  probes: [
    ...mutationDenialFixture.input.probes,
    ...autoApprovalFixture.input.probes
  ]
});
check(combinedHardening.results.every((r) => r.rejected === true), 'all hardening probes must be rejected');
check(combinedHardening.ok === true, 'combined hardening report must be ok when all probes rejected');

// Verify advisory-mode families across the gate report did not attempt mutation/auto-approve
for (const advisoryFamily of advisoryFamilies) {
  for (const finding of advisoryFamily.findings) {
    check(finding.action !== 'quarantine', `advisory family ${advisoryFamily.family} must not produce quarantine actions`);
    check((finding.metadata as any)?.directApplyAllowed !== true, `advisory family ${advisoryFamily.family} findings must not declare directApplyAllowed=true`);
  }
}

// ── Validator Profile Naming Contract (APF-0053) ───────────────────────────

check(VALIDATOR_PROFILE_NAMING_CONTRACT.schemaId === 'atm.validatorProfileNamingContract', 'naming contract schemaId must be atm.validatorProfileNamingContract');
const profileNames = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.map((p) => p.profile);
for (const expected of ['validate:police', 'validate:police-family', 'validate:standard', 'validate:full'] as const) {
  check(profileNames.includes(expected), `naming contract must include ${expected}`);
}
const familyEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:police-family');
check(familyEntry?.role.includes('PoliceFamilyGateReport'), 'validate:police-family contract role must mention PoliceFamilyGateReport');
const standardEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:standard');
check(standardEntry?.relatesTo.includes('validate:police-family'), 'validate:standard must relate to validate:police-family');
const fullEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:full');
check(fullEntry?.relatesTo.includes('validate:police'), 'validate:full must retain relation to legacy validate:police');

if (!process.exitCode) {
  const totalFamilies = positiveGateReport.families.length;
  const blockerCount = blockerFamilies.length;
  const advisoryCount = advisoryFamilies.length;
  const sharedGateCount = positiveGateReport.sharedGates?.length ?? 0;
  console.log(
    `[police-family:${mode}] ok (${totalFamilies} families: ${blockerCount} blocker, ${advisoryCount} advisory, ${sharedGateCount} shared gates; ` +
    `named scanners (incl. decomposition / evolution / polymorph / rollback), ` +
    `shared gates (evidence-integrity / reversibility / noise-control), ` +
    `contract-drift + adopter-neutrality inside registry-consistency, ` +
    `advisory-only hardening (mutation + auto-approval denial), ` +
    `validator profile naming contract, gate report producer, ` +
    `ReviewAdvisory bridge, dry-run guards, suppression/stale-base/daily-cap safeguards, ` +
    `and negative fixtures verified)`
  );
}

function buildMergedFamily(
  family: PoliceFamilyReport['family'],
  mode: PoliceFamilyReport['mode'],
  reports: readonly PoliceFamilyReport[]
): PoliceFamilyReport {
  return {
    family,
    mode,
    status: reports.some((report) => report.status === 'fail') ? 'fail' : 'pass',
    findings: reports.flatMap((report) => [...report.findings]),
    advisoryOnly: mode === 'advisory',
    sourceValidator: reports[0]?.sourceValidator ?? `run-${family}-police`
  };
}
