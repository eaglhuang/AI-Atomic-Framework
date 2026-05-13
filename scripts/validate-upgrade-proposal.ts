import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { proposeAtomicUpgrade } from '../packages/core/src/upgrade/propose.ts';
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
  check(Array.isArray(proposal.inputs) && proposal.inputs.length >= 4, 'proposal must keep input references');
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

for (const relativePath of [schemaPath, passFixturePath, blockedFixturePath, mapBumpFixturePath, atomExtractFixturePath, ...Object.values(inputPaths), 'packages/core/src/upgrade/propose.ts', 'packages/cli/src/commands/upgrade.ts']) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson(schemaPath);
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

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const expectedPass = readJson(passFixturePath);
const expectedBlocked = readJson(blockedFixturePath);
const expectedMapBump = readJson(mapBumpFixturePath);
const expectedAtomExtract = readJson(atomExtractFixturePath);
validateWithSchema(expectedPass, validate, 'proposal-pass fixture');
validateWithSchema(expectedBlocked, validate, 'proposal-blocked fixture');
validateWithSchema(expectedMapBump, validate, 'map-bump fixture');
validateWithSchema(expectedAtomExtract, validate, 'atom-extract fixture');
assertInvariants(expectedPass, 'pending');
assertInvariants(expectedBlocked, 'blocked');
assertInvariants(expectedMapBump, 'pending');
assertInvariants(expectedAtomExtract, 'pending');

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

console.log(`[upgrade-proposal:${mode}] ok (schema, invariants, core proposer, and CLI replay verified)`);
