import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { detectEvidencePatterns } from '../packages/plugin-sdk/src/detector/evidence-pattern-detector.ts';
import { metricsToProposalDraft } from '../packages/core/src/upgrade/metrics-to-proposal.ts';
import { proposeAtomicUpgrade } from '../packages/core/src/upgrade/propose.ts';
import { scanEvidencePatternReports } from '../packages/core/src/upgrade/evolution-draft.ts';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaPath = 'schemas/upgrade/upgrade-proposal.schema.json';
const passFixturePath = 'fixtures/upgrade/proposal-pass.json';
const blockedFixturePath = 'fixtures/upgrade/proposal-blocked.json';
const mapBumpFixturePath = 'fixtures/upgrade/map-bump-proposal.json';
const atomExtractFixturePath = 'fixtures/upgrade/atom-extract-proposal.json';
const evidenceDrivenFixturePath = 'fixtures/upgrade/evidence-driven-proposal.json';
const staleFixturePath = 'fixtures/upgrade/stale-proposal.json';
const mapCuratorComposeFixturePath = 'fixtures/upgrade/map-curator-compose-proposal.json';
const mapCuratorMergeFixturePath = 'fixtures/upgrade/map-curator-merge-proposal.json';
const mapCuratorDedupMergeFixturePath = 'fixtures/upgrade/map-curator-dedup-merge-proposal.json';
const mapCuratorSweepFixturePath = 'fixtures/upgrade/map-curator-sweep-proposal.json';
const metricDrivenFixturePath = 'fixtures/upgrade/metric-driven-proposal.json';
const metricRegressionBlockedFixturePath = 'fixtures/upgrade/metric-regression-blocked-proposal.json';
const scanSchemaPath = 'schemas/governance/evolution-scan-report.schema.json';
const inputPaths = {
  hashDiff: 'fixtures/upgrade/hash-diff-report.json',
  executionEvidence: 'tests/schema-fixtures/positive/minimal-execution-evidence.json',
  nonRegression: 'tests/police-fixtures/positive/non-regression-report.json',
  qualityPass: 'fixtures/upgrade/quality-comparison-pass.json',
  qualityBlocked: 'fixtures/upgrade/quality-comparison-blocked.json',
  registryCandidate: 'tests/police-fixtures/positive/registry-candidate-report.json'
};

function check(condition: any, message: any) {
  if (!condition) {
    throw new Error(`[upgrade-proposal:${mode}] ${message}`);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function input(kind: any, relativePath: any) {
  return {
    kind,
    path: relativePath,
    document: readJson(relativePath)
  };
}

function createProposalInputs(qualityPath: any) {
  return [
    input('hash-diff', inputPaths.hashDiff),
    input('execution-evidence', inputPaths.executionEvidence),
    input('non-regression', inputPaths.nonRegression),
    input('quality-comparison', qualityPath),
    input('registry-candidate', inputPaths.registryCandidate)
  ];
}

function validateWithSchema(document: any, validate: any, label: any) {
  const valid = validate(document) === true;
  check(valid, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

function assertInvariants(proposal: any, expectedStatus: any) {
  check(proposal.schemaId === 'atm.upgradeProposal', 'proposal schemaId mismatch');
  check(proposal.lifecycleMode === 'evolution', 'proposal lifecycleMode must be evolution');
  check(proposal.humanReview === 'pending', 'humanReview must remain pending');
  check(proposal.status === expectedStatus, `expected status=${expectedStatus}`);
  check(proposal.behaviorId.startsWith('behavior.'), 'behaviorId must be behavior.*');
  const minimumInputs = ['evidence-driven', 'metric-driven'].includes(proposal.proposalSource) ? 1 : 4;
  check(Array.isArray(proposal.inputs) && proposal.inputs.length >= minimumInputs, 'proposal must keep input references');
  if (proposal.status === 'blocked') {
    check(proposal.automatedGates.allPassed === false, 'blocked proposal must have allPassed=false');
    check(proposal.automatedGates.blockedGateNames.length > 0, 'blocked proposal must name blocked gates');
  } else {
    check(proposal.automatedGates.allPassed === true, 'pending proposal must have allPassed=true');
    check(proposal.automatedGates.blockedGateNames.length === 0, 'pending proposal must not name blocked gates');
  }
  if (proposal.decompositionDecision === 'atom-extract') {
    check(proposal.fork?.sourceAtomId && proposal.fork?.newAtomId, 'atom-extract proposal must include fork source and new atomId');
  }
  if (proposal.target.kind === 'map') {
    check(proposal.target.mapId, 'map target must include mapId');
    check(proposal.decompositionDecision === 'map-bump', 'map target must use map-bump decision');
    check(proposal.mapImpactScope, 'map target must include mapImpactScope');
  }
}

function runCliUpgrade(qualityPath: any, options: any = {}) {
  const cwd = options.cwd ?? root;
  const dryRun = options.dryRun ?? true;
  const args = [
    path.join(root, 'atm.mjs'),
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    ...(dryRun ? ['--dry-run'] : []),
    ...(options.mapId ? ['--target', 'map', '--map', options.mapId] : []),
    ...(options.decompositionDecision ? ['--decomposition-decision', options.decompositionDecision] : []),
    '--input', resolveInputPath(options.inputBase ?? root, inputPaths.hashDiff),
    '--input', resolveInputPath(options.inputBase ?? root, inputPaths.executionEvidence),
    '--input', resolveInputPath(options.inputBase ?? root, inputPaths.nonRegression),
    '--input', resolveInputPath(options.inputBase ?? root, qualityPath),
    '--input', resolveInputPath(options.inputBase ?? root, inputPaths.registryCandidate)
  ];
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8'
  });
  check(result.status === 0, `CLI upgrade exited ${result.status}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

function resolveInputPath(baseRoot: any, relativePath: any) {
  return path.join(baseRoot, relativePath);
}

function assertCliContextBudgetGate(result: any, expectedPassed: any) {
  const proposal = result.evidence.proposal;
  check(proposal.automatedGates.contextBudget, 'CLI proposal must include a contextBudget automated gate');
  check(proposal.automatedGates.contextBudget.passed === expectedPassed, `CLI contextBudget gate must be passed=${expectedPassed}`);
  if (expectedPassed) {
    check(!proposal.automatedGates.blockedGateNames.includes('contextBudget'), 'passing CLI proposal must not block on contextBudget');
  } else {
    check(proposal.automatedGates.blockedGateNames.includes('contextBudget'), 'blocked CLI proposal must include contextBudget in blockedGateNames');
  }
}

for (const relativePath of [schemaPath, scanSchemaPath, passFixturePath, blockedFixturePath, mapBumpFixturePath, atomExtractFixturePath, evidenceDrivenFixturePath, staleFixturePath, mapCuratorComposeFixturePath, mapCuratorMergeFixturePath, mapCuratorDedupMergeFixturePath, mapCuratorSweepFixturePath, metricDrivenFixturePath, metricRegressionBlockedFixturePath, 'fixtures/evolution/evidence-patterns/no-signal.json', 'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json', ...Object.values(inputPaths), 'packages/core/src/upgrade/propose.ts', 'packages/core/src/upgrade/evolution-draft.ts', 'packages/plugin-sdk/src/detector/evidence-pattern-detector.ts', 'packages/cli/src/commands/upgrade.ts']) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson(schemaPath);
const scanSchema = readJson(scanSchemaPath);
check(schema.required.includes('atomId'), 'schema must require atomId');
check(schema.required.includes('fromVersion'), 'schema must require fromVersion');
check(schema.required.includes('toVersion'), 'schema must require toVersion');
check(schema.required.includes('automatedGates'), 'schema must require automatedGates');
check(schema.required.includes('humanReview'), 'schema must require humanReview');
check(schema.required.includes('behaviorId'), 'schema must require behaviorId');
check(schema.properties.decompositionDecision.enum.includes('atom-extract'), 'schema must include atom-extract decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('map-bump'), 'schema must include map-bump decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('polymorphize'), 'schema must include polymorphize decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('extract-shared'), 'schema must include extract-shared decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('infect'), 'schema must include infect decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('atomize'), 'schema must include atomize decomposition decision');
check(schema.properties.proposalSource.enum.includes('evidence-driven'), 'schema must include evidence-driven proposal source');
check(schema.properties.targetSurface.enum.includes('atom-spec'), 'schema must include atom-spec target surface');
check(schema.properties.reversibility.enum.includes('rollback-safe'), 'schema must include rollback-safe reversibility');
check(schema.$defs?.inputRef?.properties?.kind?.enum?.includes('evolution-evidence'), 'schema must include evolution-evidence input kind');
check(schema.$defs?.automatedGates?.properties?.staleProposal, 'schema must expose staleProposal gate');
check(schema.$defs?.automatedGates?.properties?.mutabilityPolicy, 'schema must expose mutabilityPolicy gate for curator proposals');
check(schema.properties.sourceAtomIds, 'schema must expose sourceAtomIds for merge and sweep proposals');
check(schema.properties.targetAtomId, 'schema must expose targetAtomId for merge proposals');
check(schema.properties.sweepPlan, 'schema must expose sweepPlan for archive-only sweep proposals');
check(scanSchema.required.includes('scanId'), 'scan schema must require scanId');
check(scanSchema.properties?.scanMode?.const === 'dry-run', 'scan schema must enforce dry-run scanMode');
check(scanSchema.$defs?.proposalDraftBundleItem?.properties?.proposal?.$ref === 'https://schemas.ai-atomic-framework.dev/upgrade/upgrade-proposal.schema.json', 'scan schema must reference upgrade proposal schema');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(readJson('schemas/governance/detector-report.schema.json'));
const validate = ajv.compile(schema);
const validateScan = ajv.compile(scanSchema);

const expectedPass = readJson(passFixturePath);
const expectedBlocked = readJson(blockedFixturePath);
const expectedMapBump = readJson(mapBumpFixturePath);
const expectedAtomExtract = readJson(atomExtractFixturePath);
const expectedEvidenceDriven = readJson(evidenceDrivenFixturePath);
const expectedStale = readJson(staleFixturePath);
const expectedMapCuratorCompose = readJson(mapCuratorComposeFixturePath);
const expectedMapCuratorMerge = readJson(mapCuratorMergeFixturePath);
const expectedMapCuratorDedupMerge = readJson(mapCuratorDedupMergeFixturePath);
const expectedMapCuratorSweep = readJson(mapCuratorSweepFixturePath);
validateWithSchema(expectedPass, validate, 'proposal-pass fixture');
validateWithSchema(expectedBlocked, validate, 'proposal-blocked fixture');
validateWithSchema(expectedMapBump, validate, 'map-bump fixture');
validateWithSchema(expectedAtomExtract, validate, 'atom-extract fixture');
validateWithSchema(expectedEvidenceDriven, validate, 'evidence-driven fixture');
validateWithSchema(expectedStale, validate, 'stale proposal fixture');
validateWithSchema(expectedMapCuratorCompose, validate, 'map-curator compose fixture');
validateWithSchema(expectedMapCuratorMerge, validate, 'map-curator merge fixture');
validateWithSchema(expectedMapCuratorDedupMerge, validate, 'map-curator dedup-merge fixture');
validateWithSchema(expectedMapCuratorSweep, validate, 'map-curator sweep fixture');
assertInvariants(expectedPass, 'pending');
assertInvariants(expectedBlocked, 'blocked');
assertInvariants(expectedMapBump, 'pending');
assertInvariants(expectedAtomExtract, 'pending');
assertInvariants(expectedEvidenceDriven, 'pending');
assertInvariants(expectedStale, 'blocked');
assertInvariants(expectedMapCuratorCompose, 'pending');
assertInvariants(expectedMapCuratorMerge, 'pending');
assertInvariants(expectedMapCuratorDedupMerge, 'blocked');
assertInvariants(expectedMapCuratorSweep, 'pending');
check(expectedEvidenceDriven.proposalSource === 'evidence-driven', 'evidence-driven fixture must declare proposalSource');
check(expectedEvidenceDriven.targetSurface === 'atom-spec', 'evidence-driven fixture must target atom-spec');
check(expectedEvidenceDriven.evidenceGate?.matchedEvidenceIds?.length >= 1, 'evidence-driven fixture must cite evidence IDs');
check(expectedStale.automatedGates.blockedGateNames.includes('staleProposal'), 'stale fixture must block on staleProposal');
check(expectedMapCuratorCompose.behaviorId === 'behavior.compose' && expectedMapCuratorCompose.members.length >= 2, 'map-curator compose fixture must list members');
check(expectedMapCuratorMerge.behaviorId === 'behavior.merge' && expectedMapCuratorMerge.sourceAtomIds.length >= 1 && expectedMapCuratorMerge.targetAtomId, 'map-curator merge fixture must list source atoms and target atom');
check(expectedMapCuratorDedupMerge.behaviorId === 'behavior.dedup-merge' && expectedMapCuratorDedupMerge.automatedGates.blockedGateNames.includes('mutabilityPolicy'), 'map-curator dedup-merge fixture must block immutable target auto-promotion');
check(expectedMapCuratorSweep.behaviorId === 'behavior.sweep' && expectedMapCuratorSweep.sweepPlan.deletionAllowed === false, 'map-curator sweep fixture must be archive-only and never delete atoms');
for (const proposal of [expectedMapCuratorCompose, expectedMapCuratorMerge, expectedMapCuratorDedupMerge, expectedMapCuratorSweep]) {
  check(proposal.inputs.some((entry: any) => entry.kind === 'evolution-evidence'), `${proposal.proposalId} must cite evolution evidence input`);
  check(proposal.evidenceGate?.matchedEvidenceIds?.length >= 1, `${proposal.proposalId} must cite evidence ids`);
}

const generatedPass = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assert.deepEqual(generatedPass, expectedPass, 'generated pass proposal must match fixture');

const generatedBlocked = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityBlocked)
});
assert.deepEqual(generatedBlocked, expectedBlocked, 'generated blocked proposal must match fixture');

const cliPass = runCliUpgrade(inputPaths.qualityPass);
assertInvariants(cliPass.evidence.proposal, 'pending');
validateWithSchema(cliPass.evidence.proposal, validate, 'CLI pass proposal');
assertCliContextBudgetGate(cliPass, true);

const cliBlocked = runCliUpgrade(inputPaths.qualityBlocked);
assertInvariants(cliBlocked.evidence.proposal, 'blocked');
validateWithSchema(cliBlocked.evidence.proposal, validate, 'CLI blocked proposal');
assertCliContextBudgetGate(cliBlocked, true);

const mapProposal = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  target: { kind: 'map', mapId: 'ATM-MAP-0001' },
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assertInvariants(mapProposal, 'pending');
validateWithSchema(mapProposal, validate, 'map proposal');
assert.deepEqual(mapProposal, expectedMapBump, 'generated map-bump proposal must match fixture');

const cliMapPass = runCliUpgrade(inputPaths.qualityPass, { mapId: 'ATM-MAP-0001' });
assertInvariants(cliMapPass.evidence.proposal, 'pending');
validateWithSchema(cliMapPass.evidence.proposal, validate, 'CLI map pass proposal');

const noSignalPatternFixture = readJson('fixtures/evolution/evidence-patterns/no-signal.json');
const noSignalScan = scanEvidencePatternReports({
  repositoryRoot: root,
  detectorReports: [
    {
      path: 'fixtures/evolution/evidence-patterns/no-signal.json',
      document: noSignalPatternFixture.expectedReport
    }
  ],
  proposedBy: 'ATM Evolution Draft Bridge',
  proposedAt: '2026-05-15T00:00:00.000Z'
});
validateWithSchema(noSignalScan, validateScan, 'no-signal scan report');
check(noSignalScan.empty === true, 'no-signal scan report must be empty');
check(noSignalScan.proposalDrafts.length === 0, 'no-signal scan report must not produce proposal drafts');

const positiveSignalReport = detectEvidencePatterns({
  window: '2026-W20',
  generatedAt: '2026-05-15T00:00:00.000Z',
  thresholds: {
    minUsageCount: 10,
    minFrictionEvidence: 1,
    minConfidence: 0.5
  },
  evidence: [
    {
      evidenceId: 'evidence.positive.001',
      evidenceKind: 'review',
      signalKind: 'workflow-success',
      signalScope: 'atom',
      atomId: 'ATM-CORE-0001',
      confidence: 0.9,
      recurrence: {
        window: '2026-W20',
        count: 12
      },
      summary: 'Positive evidence should remain observation-only.',
      artifactPaths: []
    }
  ]
});
const positiveSignalScan = scanEvidencePatternReports({
  repositoryRoot: root,
  detectorReports: [
    {
      path: 'synthetic/positive-signal-report.json',
      document: positiveSignalReport as any
    }
  ],
  proposedBy: 'ATM Evolution Draft Bridge',
  proposedAt: '2026-05-15T00:00:00.000Z'
});
validateWithSchema(positiveSignalScan, validateScan, 'positive-signal scan report');
check(positiveSignalScan.empty === true, 'positive-signal scan report must not produce a proposal draft');
check(positiveSignalScan.proposalDrafts.length === 0, 'positive-signal scan report must not produce proposal drafts');

const recurringFailurePatternFixture = readJson('fixtures/evolution/evidence-patterns/recurring-failure-candidate.json');
const recurringFailureScan = scanEvidencePatternReports({
  repositoryRoot: root,
  detectorReports: [
    {
      path: 'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json',
      document: recurringFailurePatternFixture.expectedReport
    }
  ],
  proposedBy: 'ATM Evolution Draft Bridge',
  proposedAt: '2026-05-15T00:00:00.000Z'
});
validateWithSchema(recurringFailureScan, validateScan, 'recurring-failure scan report');
check(recurringFailureScan.empty === false, 'recurring-failure scan report must produce proposal drafts');
check(recurringFailureScan.proposalDrafts.length === 1, 'recurring-failure scan report must produce one proposal draft');
check(recurringFailureScan.observation.proposalDraftCount === 1, 'recurring-failure scan observation must count one proposal draft');
const recurringFailureDraft = recurringFailureScan.proposalDrafts[0].proposal;
validateWithSchema(recurringFailureDraft, validate, 'recurring-failure proposal draft');
assertInvariants(recurringFailureDraft, 'pending');
check(recurringFailureDraft.proposalSource === 'evidence-driven', 'scan proposal draft must declare proposalSource');
check(recurringFailureDraft.targetSurface === 'atom-spec', 'scan proposal draft must target atom-spec');
check(recurringFailureDraft.baseAtomVersion === '0.1.0', 'scan proposal draft must resolve the current atom base version');
check(recurringFailureDraft.toVersion === '0.1.1', 'scan proposal draft must bump patch version');
check(recurringFailureDraft.inputs.length === 1, 'scan proposal draft must keep one evolution-evidence input');
check(recurringFailureScan.proposalDrafts[0].groupIds.includes('evidence-pattern.atom.atm-core-0001.2026-w20.recurring-failure'), 'scan proposal draft must trace candidate group ids');

const extractProposal = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  behaviorId: 'behavior.evolve',
  decompositionDecision: 'atom-extract',
  fork: { sourceAtomId: 'ATM-CORE-0001', newAtomId: 'ATM-CORE-0002' },
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assertInvariants(extractProposal, 'pending');
validateWithSchema(extractProposal, validate, 'atom-extract proposal');
assert.deepEqual(extractProposal, expectedAtomExtract, 'generated atom-extract proposal must match fixture');

assert.throws(() => proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  behaviorId: 'behavior.infect',
  decompositionDecision: 'atom-bump',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
}), /behavior\.infect/);

assert.throws(() => proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  behaviorId: 'behavior.evolve',
  decompositionDecision: 'infect',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
}), /must pair/);

assert.throws(() => proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  target: { kind: 'map', mapId: 'map.legacy.sandbox' },
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
}), /Legacy mapId/);

const tempRoot = createTempWorkspace('atm-upgrade-hard-stop-');
try {
  const governedRepo = path.join(tempRoot, 'repo');
  mkdirSync(path.join(governedRepo, '.atm', 'runtime', 'budget'), { recursive: true });
  writeFileSync(path.join(governedRepo, '.atm', 'runtime', 'budget', 'default-policy.json'), `${JSON.stringify({
    policyId: 'default-policy',
    generatedAt: '2026-01-01T00:00:00.000Z',
    unit: 'tokens',
    warningTokens: 32,
    summarizeTokens: 64,
    hardStopTokens: 96,
    maxInlineArtifacts: 1,
    defaultSummary: 'Summarize large tool output before continuing.'
  }, null, 2)}\n`, 'utf8');

  const hardStopResult = runCliUpgrade(inputPaths.qualityPass, {
    cwd: governedRepo,
    dryRun: false,
    inputBase: root
  });
  assertInvariants(hardStopResult.evidence.proposal, 'blocked');
  validateWithSchema(hardStopResult.evidence.proposal, validate, 'CLI hard-stop proposal');
  assertCliContextBudgetGate(hardStopResult, false);
  check(hardStopResult.evidence.contextBudget.continuationReportPath === '.atm/history/reports/continuation/upgrade/ATM-CORE-0001.json', 'hard-stop run must surface continuation report path');
  check(hardStopResult.evidence.contextBudget.contextSummaryPath === '.atm/history/handoff/ATM-CORE-0001.json', 'hard-stop run must surface context summary path');
  check(hardStopResult.evidence.contextBudget.contextSummaryMarkdownPath === '.atm/history/handoff/ATM-CORE-0001.md', 'hard-stop run must surface context summary markdown path');
  check(hardStopResult.evidence.contextBudget.evidencePath === '.atm/history/evidence/ATM-CORE-0001.json', 'hard-stop run must surface handoff evidence path');
  check(existsSync(path.join(governedRepo, '.atm', 'history', 'reports', 'context-budget', 'upgrade-ATM-CORE-0001-1.1.0.json')), 'hard-stop run must persist the context budget report');
  check(existsSync(path.join(governedRepo, '.atm', 'history', 'reports', 'continuation', 'upgrade', 'ATM-CORE-0001.json')), 'hard-stop run must persist the continuation report');
  check(existsSync(path.join(governedRepo, '.atm', 'history', 'handoff', 'ATM-CORE-0001.json')), 'hard-stop run must persist the continuation summary json');
  check(existsSync(path.join(governedRepo, '.atm', 'history', 'handoff', 'ATM-CORE-0001.md')), 'hard-stop run must persist the continuation summary markdown');
  check(existsSync(path.join(governedRepo, '.atm', 'history', 'evidence', 'ATM-CORE-0001.json')), 'hard-stop run must persist the handoff evidence');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

// M6 — metric-driven track
const expectedMetricDriven = readJson(metricDrivenFixturePath);
const expectedMetricRegressionBlocked = readJson(metricRegressionBlockedFixturePath);
validateWithSchema(expectedMetricDriven, validate, 'metric-driven fixture');
validateWithSchema(expectedMetricRegressionBlocked, validate, 'metric-regression-blocked fixture');
assertInvariants(expectedMetricDriven, 'pending');
assertInvariants(expectedMetricRegressionBlocked, 'blocked');
check(expectedMetricDriven.proposalSource === 'metric-driven', 'metric-driven fixture must declare proposalSource');
check(expectedMetricDriven.targetSurface === 'atom-spec', 'metric-driven fixture must target atom-spec');
check(Boolean(expectedMetricDriven.baseEvidenceWatermark), 'metric-driven fixture must include baseEvidenceWatermark');
check(expectedMetricDriven.automatedGates.staleProposal?.passed === true, 'metric-driven fixture must share staleProposal gate');
check(expectedMetricRegressionBlocked.proposalSource === 'metric-driven', 'metric-regression-blocked fixture must declare proposalSource');
check(Boolean(expectedMetricRegressionBlocked.baseEvidenceWatermark), 'metric-regression-blocked fixture must include baseEvidenceWatermark');
check(expectedMetricRegressionBlocked.automatedGates.staleProposal?.passed === true, 'metric-regression-blocked fixture must share staleProposal gate');
check(expectedMetricRegressionBlocked.automatedGates.blockedGateNames.includes('qualityComparison'), 'metric-regression-blocked fixture must block on qualityComparison');

const metricImprovedDraft = metricsToProposalDraft({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.1.0',
  toVersion: '1.1.1',
  proposedAt: '2026-05-15T00:00:00.000Z',
  qualityReport: {
    passed: true,
    reportId: 'police.upgrade-quality-pass.fixture',
    reportPath: 'fixtures/upgrade/quality-comparison-pass.json'
  }
});
check(metricImprovedDraft.blocked === false, 'metricsToProposalDraft must return non-blocked for improvement');
validateWithSchema(metricImprovedDraft.draft, validate, 'metrics-to-proposal adapter pass output');
check(Boolean(metricImprovedDraft.draft.baseEvidenceWatermark), 'metrics-to-proposal adapter pass output must include baseEvidenceWatermark');
check((metricImprovedDraft.draft.automatedGates as any).staleProposal?.passed === true, 'metrics-to-proposal adapter pass output must include staleProposal gate');

const metricRegressionDraft = metricsToProposalDraft({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.1.0',
  toVersion: '1.1.1',
  proposedAt: '2026-05-15T00:00:00.000Z',
  qualityReport: {
    passed: false,
    reportId: 'police.upgrade-quality-blocked.fixture',
    reportPath: 'fixtures/upgrade/quality-comparison-blocked.json'
  }
});
check(metricRegressionDraft.blocked === true, 'metricsToProposalDraft must return blocked for regression');
validateWithSchema(metricRegressionDraft.draft, validate, 'metrics-to-proposal adapter blocked output');
check(Boolean(metricRegressionDraft.draft.baseEvidenceWatermark), 'metrics-to-proposal adapter blocked output must include baseEvidenceWatermark');
check((metricRegressionDraft.draft.automatedGates as any).staleProposal?.passed === true, 'metrics-to-proposal adapter blocked output must include staleProposal gate');
check(
  (metricRegressionDraft.draft.automatedGates as Record<string, unknown> & { blockedGateNames: string[] }).blockedGateNames.includes('qualityComparison'),
  'regression draft must block on qualityComparison'
);

// M7 — evolution-loop example governance fixtures
const evolutionLoopGovernanceDir = 'examples/atom-evolution-loop/governance';
const evolutionLoopFixtures: [string, string][] = [
  ['demo-atom-spec-proposal.json', 'demo-atom-spec evolution-loop fixture'],
  ['demo-atom-map-proposal.json', 'demo-atom-map evolution-loop fixture'],
  ['demo-rejected-proposal.json', 'demo-rejected evolution-loop fixture'],
  ['demo-stale-proposal.json', 'demo-stale evolution-loop fixture']
];
for (const [file, label] of evolutionLoopFixtures) {
  const fixture = readJson(`${evolutionLoopGovernanceDir}/${file}`);
  validateWithSchema(fixture, validate, label);
  assertInvariants(fixture, fixture.status);
}
check(
  (readJson('examples/atom-evolution-loop/governance/demo-atom-spec-proposal.json') as any).targetSurface === 'atom-spec',
  'M7 demo-atom-spec fixture must target atom-spec'
);
check(
  (readJson('examples/atom-evolution-loop/governance/demo-atom-map-proposal.json') as any).targetSurface === 'atom-map',
  'M7 demo-atom-map fixture must target atom-map'
);
check(
  (readJson('examples/atom-evolution-loop/governance/demo-rejected-proposal.json') as any).automatedGates?.blockedGateNames?.includes('qualityComparison'),
  'M7 demo-rejected fixture must block on qualityComparison'
);
check(
  (readJson('examples/atom-evolution-loop/governance/demo-stale-proposal.json') as any).automatedGates?.blockedGateNames?.includes('staleProposal'),
  'M7 demo-stale fixture must block on staleProposal'
);

console.log(`[upgrade-proposal:${mode}] ok (schema, invariants, core proposer, CLI replay, metric-driven track, and evolution-loop fixtures verified)`);
