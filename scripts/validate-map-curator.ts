import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { curateAtomMapEvolution } from '../packages/core/src/upgrade/map-curator.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const curatorSchemaPath = 'schemas/governance/map-curator-report.schema.json';
const upgradeSchemaPath = 'schemas/upgrade/upgrade-proposal.schema.json';
const callerGraphFixturePath = 'fixtures/evolution/map-curator/caller-graph-compose.json';
const overlapFixturePath = 'fixtures/evolution/map-curator/input-output-overlap.json';
const failureClusterFixturePath = 'fixtures/evolution/map-curator/recurring-failure-cluster.json';
const composeProposalPath = 'fixtures/upgrade/map-curator-compose-proposal.json';
const mergeProposalPath = 'fixtures/upgrade/map-curator-merge-proposal.json';
const dedupMergeProposalPath = 'fixtures/upgrade/map-curator-dedup-merge-proposal.json';
const sweepProposalPath = 'fixtures/upgrade/map-curator-sweep-proposal.json';

function check(condition: any, message: any) {
  if (!condition) {
    throw new Error(`[map-curator:${mode}] ${message}`);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function materializeInput(fixturePath: string) {
  const fixture = readJson(fixturePath);
  return {
    ...fixture.input,
    repositoryRoot: root
  };
}

for (const relativePath of [
  curatorSchemaPath,
  upgradeSchemaPath,
  'packages/core/src/upgrade/map-curator.ts',
  callerGraphFixturePath,
  overlapFixturePath,
  failureClusterFixturePath,
  composeProposalPath,
  mergeProposalPath,
  dedupMergeProposalPath,
  sweepProposalPath
]) {
  check(existsSync(path.join(root, relativePath)), `missing required M5 file: ${relativePath}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const upgradeSchema = readJson(upgradeSchemaPath);
ajv.addSchema(upgradeSchema);
const validateCuratorReport = ajv.compile(readJson(curatorSchemaPath));
const validateUpgradeProposal = ajv.compile(upgradeSchema);

function validateWithSchema(document: any, validate: any, label: string) {
  const valid = validate(document) === true;
  check(valid, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

function assertProposalUsesEvidenceInput(proposal: any, evidenceIds: readonly string[], label: string) {
  check(
    proposal.inputs.some((input: any) => input.kind === 'evolution-evidence' && input.schemaId === 'atm.atomMapCuratorReport'),
    `${label} must cite atom-map-curator evidence input`
  );
  for (const evidenceId of evidenceIds) {
    check(proposal.evidenceGate.matchedEvidenceIds.includes(evidenceId), `${label} must cite evidence id ${evidenceId}`);
  }
}

const composeReport = curateAtomMapEvolution(materializeInput(callerGraphFixturePath));
validateWithSchema(composeReport, validateCuratorReport, 'caller graph curator report');
check(composeReport.empty === false, 'caller graph report must produce a proposal draft');
check(composeReport.proposalDrafts.length === 1, 'caller graph report must produce one proposal draft');
const generatedComposeProposal = composeReport.proposalDrafts[0].proposal;
const composeProposalFixture = readJson(composeProposalPath);
validateWithSchema(composeProposalFixture, validateUpgradeProposal, 'compose proposal fixture');
validateWithSchema(generatedComposeProposal, validateUpgradeProposal, 'generated compose proposal');
assert.deepEqual(generatedComposeProposal, composeProposalFixture, 'generated compose proposal must match fixture');
check(composeProposalFixture.behaviorId === 'behavior.compose', 'compose fixture must use behavior.compose');
check(composeProposalFixture.members.length === 3, 'compose proposal must list members');
assertProposalUsesEvidenceInput(composeProposalFixture, composeReport.proposalDrafts[0].sourceEvidenceIds, 'compose proposal');

const overlapReport = curateAtomMapEvolution(materializeInput(overlapFixturePath));
validateWithSchema(overlapReport, validateCuratorReport, 'input/output overlap curator report');
check(overlapReport.proposalDrafts.length === 2, 'input/output overlap report must produce merge and dedup-merge drafts');
const mergeDraft = overlapReport.proposalDrafts.find((draft) => draft.behaviorId === 'behavior.merge');
const dedupDraft = overlapReport.proposalDrafts.find((draft) => draft.behaviorId === 'behavior.dedup-merge');
check(Boolean(mergeDraft), 'overlap report must include behavior.merge draft');
check(Boolean(dedupDraft), 'overlap report must include behavior.dedup-merge draft');
const mergeProposalFixture = readJson(mergeProposalPath);
const dedupMergeProposalFixture = readJson(dedupMergeProposalPath);
validateWithSchema(mergeProposalFixture, validateUpgradeProposal, 'merge proposal fixture');
validateWithSchema(dedupMergeProposalFixture, validateUpgradeProposal, 'dedup-merge proposal fixture');
validateWithSchema(mergeDraft?.proposal, validateUpgradeProposal, 'generated merge proposal');
validateWithSchema(dedupDraft?.proposal, validateUpgradeProposal, 'generated dedup-merge proposal');
assert.deepEqual(mergeDraft?.proposal, mergeProposalFixture, 'generated merge proposal must match fixture');
assert.deepEqual(dedupDraft?.proposal, dedupMergeProposalFixture, 'generated dedup-merge proposal must match fixture');
check(mergeProposalFixture.sourceAtomIds.length === 2, 'merge proposal must list source atoms');
check(mergeProposalFixture.targetAtomId === 'ATM-CORE-0001', 'merge proposal must list target atom');
check(dedupMergeProposalFixture.sourceAtomIds.length === 2, 'dedup-merge proposal must list source atoms');
check(dedupMergeProposalFixture.targetAtomId === 'ATM-CORE-0003', 'dedup-merge proposal must list target atom');
check(dedupDraft?.autoPromoteEligible === false, 'immutable dedup-merge target must not be auto-promote eligible');
check(dedupMergeProposalFixture.status === 'blocked', 'immutable dedup-merge proposal must be blocked');
check(dedupMergeProposalFixture.automatedGates.blockedGateNames.includes('mutabilityPolicy'), 'immutable dedup-merge proposal must block on mutabilityPolicy');
assertProposalUsesEvidenceInput(mergeProposalFixture, mergeDraft?.sourceEvidenceIds ?? [], 'merge proposal');
assertProposalUsesEvidenceInput(dedupMergeProposalFixture, dedupDraft?.sourceEvidenceIds ?? [], 'dedup-merge proposal');

const sweepReport = curateAtomMapEvolution(materializeInput(failureClusterFixturePath));
validateWithSchema(sweepReport, validateCuratorReport, 'recurring failure cluster curator report');
check(sweepReport.proposalDrafts.length === 1, 'recurring failure cluster report must produce one sweep draft');
const generatedSweepProposal = sweepReport.proposalDrafts[0].proposal;
const sweepProposalFixture = readJson(sweepProposalPath);
validateWithSchema(sweepProposalFixture, validateUpgradeProposal, 'sweep proposal fixture');
validateWithSchema(generatedSweepProposal, validateUpgradeProposal, 'generated sweep proposal');
assert.deepEqual(generatedSweepProposal, sweepProposalFixture, 'generated sweep proposal must match fixture');
check(sweepProposalFixture.behaviorId === 'behavior.sweep', 'sweep fixture must use behavior.sweep');
check(sweepProposalFixture.sweepPlan.mode === 'archive-only', 'sweep proposal must be archive-only');
check(sweepProposalFixture.sweepPlan.deletionAllowed === false, 'sweep proposal must not delete atoms');
check(sweepProposalFixture.members.every((member: any) => member.from === member.to), 'sweep proposal must preserve member versions');
assertProposalUsesEvidenceInput(sweepProposalFixture, sweepReport.proposalDrafts[0].sourceEvidenceIds, 'sweep proposal');

const emptyReport = curateAtomMapEvolution({
  repositoryRoot: root,
  reportPath: 'synthetic/empty-map-curator.json',
  generatedAt: '2026-05-15T12:30:00.000Z',
  callerGraphs: [
    {
      sequenceId: 'caller-graph-below-threshold',
      atomIds: ['ATM-CORE-0001'],
      occurrenceCount: 1,
      evidenceIds: [],
      targetMapId: 'ATM-MAP-0001',
      confidence: 0.1
    }
  ]
});
validateWithSchema(emptyReport, validateCuratorReport, 'empty curator report');
check(emptyReport.empty === true, 'insufficient map curator signals must produce an empty report');
check(emptyReport.observations.length === 1, 'insufficient map curator signals must produce observation-only output');

console.log(`[map-curator:${mode}] ok (compose, merge, dedup-merge, sweep, immutable target, evidence refs, and empty report verified)`);