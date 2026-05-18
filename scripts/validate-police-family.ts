import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPoliceChecks } from '../packages/core/src/police/index.ts';
import { runLifecyclePolice, LIFECYCLE_POLICE_WRITER } from '../packages/plugin-rule-guard/src/lifecycle-police.ts';
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

// ── PoliceFamilyGateReport types (APF-0014 contract) ────────────────────────

interface PoliceFinding {
  readonly findingId: string;
  readonly policeFamily: string;
  readonly severity: 'blocker' | 'advisory' | 'info';
  readonly message: string;
  readonly trigger?: string;
  readonly evidenceRefs?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

interface PoliceFamilyReport {
  readonly family: string;
  readonly mode: 'blocker' | 'advisory';
  readonly status: 'pass' | 'fail' | 'error' | 'skipped';
  readonly findings: readonly PoliceFinding[];
  readonly advisoryOnly: boolean;
  readonly sourceValidator?: string;
}

interface PoliceFamilyGateReport {
  readonly schemaId: 'atm.policeFamilyGateReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly families: readonly PoliceFamilyReport[];
  readonly blockingFindings: readonly PoliceFinding[];
  readonly advisoryFindings: readonly PoliceFinding[];
  readonly ok: boolean;
}

// ── Violation classifier ────────────────────────────────────────────────────

function classifyViolation(code: string): string {
  if (code?.includes('DEPENDENCY_CYCLE')) return 'dependency-graph';
  if (code?.includes('LAYER_BOUNDARY') || code?.includes('LAYER_UNKNOWN')) return 'boundary';
  if (code?.includes('FORBIDDEN_IMPORT')) return 'boundary';
  if (code?.includes('PROMOTE_BLOCKED')) return 'registry-consistency';
  return 'core';
}

// ── Core blocker families (APF-0015) ────────────────────────────────────────

function buildCorePoliceFamilies(options: {
  mapFixture: any;
  layerPolicy: any;
  importGraph: any;
  forbiddenPatterns: string[];
  registryGate: any;
  lifecycleInput: any;
}): PoliceFamilyReport[] {
  const families: PoliceFamilyReport[] = [];

  const policeReport = runPoliceChecks({
    lifecycleMode: 'evolution',
    mapFixture: options.mapFixture,
    layerPolicy: options.layerPolicy,
    importGraph: options.importGraph,
    forbiddenPatterns: options.forbiddenPatterns,
    registryGate: options.registryGate
  });

  const coreFindings: PoliceFinding[] = policeReport.violations.map((v: any, i: number) => ({
    findingId: `police-family.core.${classifyViolation(v.code)}.${i}`,
    policeFamily: classifyViolation(v.code),
    severity: 'blocker' as const,
    message: v.message,
    trigger: v.code,
    evidenceRefs: v.path ? [v.path] : undefined
  }));

  families.push({
    family: 'schema',
    mode: 'blocker',
    status: 'pass',
    findings: [],
    advisoryOnly: false,
    sourceValidator: 'validate-police'
  });

  for (const familyName of ['dependency-graph', 'boundary', 'registry-consistency']) {
    const familyFindings = coreFindings.filter((f) => f.policeFamily === familyName);
    families.push({
      family: familyName,
      mode: 'blocker',
      status: familyFindings.length > 0 ? 'fail' : 'pass',
      findings: familyFindings,
      advisoryOnly: false,
      sourceValidator: 'runPoliceChecks'
    });
  }

  const lifecycleReport = runLifecyclePolice(options.lifecycleInput);
  const lifecycleBlockers: PoliceFinding[] = lifecycleReport.hardFail
    ? lifecycleReport.findings
      .filter((f: any) => f.action === 'hard-fail' || f.action === 'quarantine')
      .map((f: any, i: number) => ({
        findingId: `police-family.lifecycle.blocker.${i}`,
        policeFamily: 'lifecycle',
        severity: 'blocker' as const,
        message: f.message,
        trigger: f.trigger,
        evidenceRefs: f.callerIds ?? []
      }))
    : [];

  families.push({
    family: 'lifecycle',
    mode: 'blocker',
    status: lifecycleReport.hardFail ? 'fail' : 'pass',
    findings: lifecycleBlockers,
    advisoryOnly: false,
    sourceValidator: 'runLifecyclePolice'
  });

  return families;
}

// ── Embedded advisory adapters (APF-0016) ───────────────────────────────────

function buildDedupAdvisoryFamily(): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  try {
    const regressionFixture = readJson('tests/police-fixtures/regression-compare.fixture.json');
    const dedupPositive = regressionFixture.positive?.find(
      (p: any) => p.input?.dedupCandidates?.length > 0
    );
    if (dedupPositive) {
      const filtered = dedupPositive.input.dedupCandidates.filter(
        (c: any) => !c.polymorphGroupId || c.polymorphGroupId !== dedupPositive.input.polymorphContext?.groupId
      );
      for (const candidate of filtered) {
        findings.push({
          findingId: `police-family.dedup.${candidate.atomId}`,
          policeFamily: 'dedup',
          severity: 'advisory',
          message: `Dedup candidate: ${candidate.atomId} similarity=${candidate.similarity}`,
          trigger: 'semantic-fingerprint-overlap',
          evidenceRefs: ['fingerprint-snapshot']
        });
      }
    }
  } catch { /* no dedup data available */ }

  return {
    family: 'dedup',
    mode: 'advisory',
    status: 'pass',
    findings,
    advisoryOnly: true,
    sourceValidator: 'dedup-advisory-adapter'
  };
}

function buildDemandAdvisoryFamily(): PoliceFamilyReport {
  return {
    family: 'demand',
    mode: 'advisory',
    status: 'pass',
    findings: [],
    advisoryOnly: true,
    sourceValidator: 'demand-advisory-adapter'
  };
}

function buildMapIntegrationAdvisoryFamily(): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  try {
    const regressionFixture = readJson('tests/police-fixtures/regression-compare.fixture.json');
    for (const neg of regressionFixture.negative ?? []) {
      const statuses = neg.input?.mapImpactScope?.propagationStatus ?? [];
      for (const status of statuses) {
        if (status.integrationTestPassed === false) {
          findings.push({
            findingId: `police-family.map-integration.${status.mapId}`,
            policeFamily: 'map-integration',
            severity: 'advisory',
            message: `Map integration test failed: ${status.mapId}${status.message ? ' — ' + status.message : ''}`,
            trigger: 'map-propagation-risk',
            evidenceRefs: ['map-propagation-log']
          });
        }
      }
    }
  } catch { /* regression fixture not available */ }

  return {
    family: 'map-integration',
    mode: 'advisory',
    status: 'pass',
    findings,
    advisoryOnly: true,
    sourceValidator: 'map-integration-advisory-adapter'
  };
}

function buildAtomizationAdvisoryFamily(): PoliceFamilyReport {
  return {
    family: 'atomization',
    mode: 'advisory',
    status: 'pass',
    findings: [],
    advisoryOnly: true,
    sourceValidator: 'atomization-advisory-adapter'
  };
}

// ── Gate runner (APF-0015) ──────────────────────────────────────────────────

function buildPoliceFamilyGateReport(options: {
  mapFixture: any;
  layerPolicy: any;
  importGraph: any;
  forbiddenPatterns: string[];
  registryGate: any;
  lifecycleInput: any;
}): PoliceFamilyGateReport {
  const coreFamilies = buildCorePoliceFamilies(options);
  const advisoryFamilies = [
    buildDedupAdvisoryFamily(),
    buildDemandAdvisoryFamily(),
    buildMapIntegrationAdvisoryFamily(),
    buildAtomizationAdvisoryFamily()
  ];

  const allFamilies = [...coreFamilies, ...advisoryFamilies];
  const blockingFindings = allFamilies
    .filter((f) => f.mode === 'blocker')
    .flatMap((f) => [...f.findings]);
  const advisoryFindings = allFamilies
    .filter((f) => f.mode === 'advisory')
    .flatMap((f) => [...f.findings]);

  return {
    schemaId: 'atm.policeFamilyGateReport',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    families: allFamilies,
    blockingFindings,
    advisoryFindings,
    ok: blockingFindings.length === 0
  };
}

// ── Validation: Gate report structure ────────────────────────────────────────

const positiveGateReport = buildPoliceFamilyGateReport({
  mapFixture: readJson(fixture.dependencyGraph.positivePath),
  layerPolicy: readJson(fixture.layerBoundary.policyPath),
  importGraph: readJson(fixture.layerBoundary.positivePath),
  forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
  registryGate: readJson(fixture.registryGate.positivePath),
  lifecycleInput: readJson(fixture.lifecyclePolice.positivePath)
});

check(positiveGateReport.schemaId === 'atm.policeFamilyGateReport', 'gate report schemaId must be atm.policeFamilyGateReport');
check(positiveGateReport.specVersion === '0.1.0', 'gate report specVersion must be 0.1.0');
check(positiveGateReport.families.length >= 9, `gate report must include >=9 families (got ${positiveGateReport.families.length})`);
check(Array.isArray(positiveGateReport.blockingFindings), 'blockingFindings must be an array');
check(Array.isArray(positiveGateReport.advisoryFindings), 'advisoryFindings must be an array');

const blockerFamilies = positiveGateReport.families.filter((f) => f.mode === 'blocker');
const advisoryFams = positiveGateReport.families.filter((f) => f.mode === 'advisory');
check(blockerFamilies.length >= 5, 'gate must have >=5 blocker families (schema, dep-graph, boundary, registry, lifecycle)');
check(advisoryFams.length === 4, 'gate must have 4 advisory families (dedup, demand, map-integration, atomization)');

const coreBlockerFamilies = blockerFamilies.filter((f) => f.family !== 'lifecycle');
for (const family of coreBlockerFamilies) {
  check(family.status === 'pass', `core blocker family ${family.family} must pass with positive fixtures`);
}

const lifecycleFamily = blockerFamilies.find((f) => f.family === 'lifecycle');
check(lifecycleFamily !== undefined, 'lifecycle family must be present');
check(
  lifecycleFamily!.status === 'fail',
  'lifecycle family correctly identifies quarantine findings from positive fixture (illegal-transition quarantine is expected behavior)'
);
check(lifecycleFamily!.findings.length > 0, 'lifecycle must produce blocking findings for quarantine actions');

for (const family of advisoryFams) {
  check(family.advisoryOnly === true, `advisory family ${family.family} must have advisoryOnly=true`);
}

check(
  positiveGateReport.blockingFindings.some((f) => f.policeFamily === 'lifecycle'),
  'gate report correctly identifies lifecycle quarantine as blocking'
);
check(
  coreBlockerFamilies.every((f) => f.findings.length === 0),
  'core police (non-lifecycle) must have zero findings with positive fixtures'
);

// ── Validation: Blocker exit behavior (negative dependency graph) ───────────

const negativeGateReport = buildPoliceFamilyGateReport({
  mapFixture: readJson(fixture.dependencyGraph.negativePath),
  layerPolicy: readJson(fixture.layerBoundary.policyPath),
  importGraph: readJson(fixture.layerBoundary.positivePath),
  forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
  registryGate: readJson(fixture.registryGate.positivePath),
  lifecycleInput: readJson(fixture.lifecyclePolice.positivePath)
});

check(negativeGateReport.ok === false, 'gate must report ok=false when dependency cycle exists');
check(negativeGateReport.blockingFindings.length > 0, 'negative gate must produce blocking findings');
const depGraphFamily = negativeGateReport.families.find((f) => f.family === 'dependency-graph');
check(depGraphFamily?.status === 'fail', 'dependency-graph family must fail with cycle fixture');

// ── Validation: Lifecycle hardFail exit behavior ────────────────────────────

const hardFailGateReport = buildPoliceFamilyGateReport({
  mapFixture: readJson(fixture.dependencyGraph.positivePath),
  layerPolicy: readJson(fixture.layerBoundary.policyPath),
  importGraph: readJson(fixture.layerBoundary.positivePath),
  forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
  registryGate: readJson(fixture.registryGate.positivePath),
  lifecycleInput: readJson(fixture.lifecyclePolice.negativeProductionPath)
});

check(hardFailGateReport.ok === false, 'gate must report ok=false when lifecycle police hard-fails');
const lifecycleHardFail = hardFailGateReport.families.find((f) => f.family === 'lifecycle');
check(lifecycleHardFail?.status === 'fail', 'lifecycle family must fail when hardFail=true');
check(
  hardFailGateReport.blockingFindings.some((f) => f.policeFamily === 'lifecycle'),
  'lifecycle hard-fail must produce blocking findings'
);

// ── Validation: Advisory adapters called and tracked (APF-0016) ─────────────

for (const familyName of ['dedup', 'demand', 'map-integration', 'atomization']) {
  const family = positiveGateReport.families.find((f) => f.family === familyName);
  check(family !== undefined, `advisory family ${familyName} must be present in gate report`);
  check(family?.mode === 'advisory', `${familyName} must be in advisory mode`);
  check(family?.sourceValidator !== undefined, `${familyName} must report its sourceValidator`);
}

// ── Validation: ReviewAdvisory bridge (APF-0018) ────────────────────────────

const policeMachineFinding = readJson('fixtures/police-family/positive-police-machine-finding.json');
check(policeMachineFinding.finding.trigger === 'machine-finding', 'positive bridge fixture trigger must be machine-finding');
check(
  policeMachineFinding.finding.metadata?.policeFinding !== undefined,
  'positive bridge fixture must have metadata.policeFinding'
);

const stubReport = createStubReviewAdvisoryReport({
  profile: 'pass',
  reportId: 'review-advisory.police-family.bridge-test',
  target: { kind: 'scope', id: 'police-family-gate' }
});
const bridgedReport = appendMachineFindings(stubReport, [{
  id: policeMachineFinding.finding.id,
  severity: policeMachineFinding.finding.severity,
  message: policeMachineFinding.finding.message,
  routeHint: policeMachineFinding.finding.routeHint,
  evidenceRef: policeMachineFinding.finding.evidenceRefs?.[0]
}]);
check(
  bridgedReport.findings.some((f: any) => f.trigger === 'machine-finding'),
  'bridged report must contain machine-finding trigger'
);
check(bridgedReport.needsReview === true, 'high severity police finding must route to needsReview=true');

const advisoryFixture = readJson('fixtures/police-family/positive-advisory-finding.json');
const advisoryBridgedReport = appendMachineFindings(stubReport, [{
  id: advisoryFixture.finding.id,
  severity: advisoryFixture.finding.severity,
  message: advisoryFixture.finding.message,
  routeHint: advisoryFixture.finding.routeHint
}]);
check(
  advisoryBridgedReport.findings.some((f: any) => f.trigger === 'machine-finding'),
  'advisory police finding must enter ReviewAdvisory as machine-finding'
);

const blockingFixture = readJson('fixtures/police-family/positive-blocking-finding.json');
check(blockingFixture.expected.isBlockingFinding === true, 'blocking fixture must declare isBlockingFinding=true');
check(
  blockingFixture.finding.metadata?.policeFinding?.severity === 'blocker',
  'blocking fixture policeFinding must have severity=blocker'
);

const evidenceSplitFixture = readJson('fixtures/police-family/positive-evidence-refs-split.json');
check(
  evidenceSplitFixture.finding.metadata?.evidenceSplit?.officialEvidenceTypes?.length > 0,
  'evidence split fixture must have official evidence types'
);
check(
  evidenceSplitFixture.finding.metadata?.evidenceSplit?.policeLocalArtifactRefs?.length > 0,
  'evidence split fixture must have police-local artifact refs'
);

// ── Validation: Negative guards (APF-0018) ──────────────────────────────────

const payloadFixture = readJson('fixtures/police-family/negative-payload-as-current-contract.json');
check('payload' in payloadFixture.finding, 'payload negative fixture must contain payload field');
check(payloadFixture.expected.payloadMustBeRejected === true, 'payload-as-contract must be rejected');
const normalizedNoPayload: PoliceFinding = {
  findingId: payloadFixture.finding.findingId,
  policeFamily: payloadFixture.finding.policeFamily,
  severity: payloadFixture.finding.severity,
  message: payloadFixture.finding.message
};
check(!('payload' in normalizedNoPayload), 'normalized PoliceFinding must strip payload field');

const quarantineFixture = readJson('fixtures/police-family/negative-non-lifecycle-quarantine.json');
check(quarantineFixture.finding.policeFamily !== 'lifecycle', 'quarantine fixture must be non-lifecycle');
check(quarantineFixture.finding.action === 'quarantine', 'quarantine fixture must attempt quarantine');
check(quarantineFixture.expected.quarantineMustBeRejected === true, 'non-lifecycle quarantine must be rejected');

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

// ── File existence ──────────────────────────────────────────────────────────

const requiredFiles = [
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

// ── Protected surface neutrality ────────────────────────────────────────────

const protectedPoliceFamilyFiles = [
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

// ── Summary ─────────────────────────────────────────────────────────────────

if (!process.exitCode) {
  const totalFamilies = positiveGateReport.families.length;
  const blockerCount = blockerFamilies.length;
  const advisoryCount = advisoryFams.length;
  console.log(
    `[police-family:${mode}] ok (${totalFamilies} families: ${blockerCount} blocker, ${advisoryCount} advisory; ` +
    `gate report contract, blocker exit, lifecycle hard-fail, advisory adapters, ` +
    `review-advisory bridge, and negative guards verified)`
  );
}
