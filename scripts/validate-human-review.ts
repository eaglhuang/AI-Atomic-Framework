import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  computeDecisionSnapshotHash,
  createHumanReviewDecisionLog,
  createHumanReviewQueueDocument,
  createHumanReviewQueueRecord,
  renderHumanReviewQueueMarkdown,
  validateHumanReviewDecisionLog,
  validateHumanReviewQueueDocument
} from '../packages/plugin-human-review/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaPath = 'schemas/human-review/decision.schema.json';
const evidenceSchemaPath = 'schemas/governance/evidence.schema.json';
const proposalFixturePath = 'fixtures/upgrade/proposal-pass.json';
const approveSnapshotPath = 'fixtures/human-review/approve.snapshot.json';
const rejectSnapshotPath = 'fixtures/human-review/reject.snapshot.json';
const hashMismatchSnapshotPath = 'fixtures/human-review/hash-mismatch.snapshot.json';

function check(condition: any, message: any) {
  if (!condition) {
    throw new Error(`[human-review:${mode}] ${message}`);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  schemaPath,
  evidenceSchemaPath,
  proposalFixturePath,
  approveSnapshotPath,
  rejectSnapshotPath,
  hashMismatchSnapshotPath,
  'packages/plugin-human-review/src/queue.ts',
  'packages/plugin-human-review/src/decision-log.ts',
  'packages/plugin-human-review/src/index.ts',
  'packages/cli/src/commands/review.ts'
]) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const decisionSchema = readJson(schemaPath);
check(decisionSchema.required.includes('decisionSnapshotHash'), 'decision schema must require decisionSnapshotHash');
check(decisionSchema.required.includes('queueRecord'), 'decision schema must require queueRecord');
check(decisionSchema.required.includes('evidence'), 'decision schema must require evidence payload');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(readJson(evidenceSchemaPath), 'governance-evidence');
const validateDecision = ajv.compile(decisionSchema);

const proposal = readJson(proposalFixturePath);
const queueRecord = createHumanReviewQueueRecord(proposal, {
  status: 'approved',
  review: {
    decision: 'approve',
    reason: 'Automated gates are green and no manual risk surfaced.',
    decidedBy: 'ATM reviewer',
    decidedAt: '2026-01-02T00:00:00.000Z',
    decisionSnapshotHash: computeDecisionSnapshotHash(proposal),
    evidenceId: 'human-review.proposal.atm-core-0001.from-1.0.0.to-1.1.0.atom.behavior-evolve.approve'
  }
});

const queueDoc = createHumanReviewQueueDocument([queueRecord], {
  generatedAt: '2026-01-02T00:00:00.000Z'
});
const queueValidation = validateHumanReviewQueueDocument(queueDoc);
check(queueValidation.ok, `queue document must validate: ${JSON.stringify(queueValidation.issues)}`);

const decisionLog = createHumanReviewDecisionLog({
  queueRecord,
  decision: 'approve',
  reason: 'Automated gates are green and no manual risk surfaced.',
  decidedBy: 'ATM reviewer',
  decidedAt: '2026-01-02T00:00:00.000Z',
  queuePath: '.atm/history/reports/upgrade-proposals.json',
  projectionPath: '.atm/history/reports/upgrade-proposals.md',
  evidenceId: 'human-review.proposal.atm-core-0001.from-1.0.0.to-1.1.0.atom.behavior-evolve.approve'
});

const decisionValidation = validateHumanReviewDecisionLog(decisionLog);
check(decisionValidation.ok, `decision log must validate: ${JSON.stringify(decisionValidation.issues)}`);
check(validateDecision(decisionLog) === true, `decision schema validation failed: ${JSON.stringify(validateDecision.errors)}`);

const approveSnapshot = readJson(approveSnapshotPath);
const rejectSnapshot = readJson(rejectSnapshotPath);
const mismatchSnapshot = readJson(hashMismatchSnapshotPath);

check(validateDecision(approveSnapshot) === true, `approve snapshot schema validation failed: ${JSON.stringify(validateDecision.errors)}`);
check(validateDecision(rejectSnapshot) === true, `reject snapshot schema validation failed: ${JSON.stringify(validateDecision.errors)}`);
check(validateDecision(mismatchSnapshot) === true, `hash mismatch snapshot schema validation failed: ${JSON.stringify(validateDecision.errors)}`);

const approveValidation = validateHumanReviewDecisionLog(approveSnapshot);
check(approveValidation.ok, `approve snapshot must pass semantic validation: ${JSON.stringify(approveValidation.issues)}`);
const rejectValidation = validateHumanReviewDecisionLog(rejectSnapshot);
check(rejectValidation.ok, `reject snapshot must pass semantic validation: ${JSON.stringify(rejectValidation.issues)}`);
const mismatchValidation = validateHumanReviewDecisionLog(mismatchSnapshot);
check(!mismatchValidation.ok, 'hash-mismatch snapshot must fail semantic validation');
check(mismatchValidation.issues.some((issue) => issue.includes('decisionSnapshotHash')), 'hash-mismatch snapshot must fail on decisionSnapshotHash linkage');

assert.equal(
  renderHumanReviewQueueMarkdown(queueDoc),
  [
    '# Upgrade Proposals',
    '',
    'Generated at 2026-01-02T00:00:00.000Z',
    '',
    '| proposalId | atomId | fromVersion → toVersion | decompositionDecision | automatedGates | status |',
    '| --- | --- | --- | --- | --- | --- |',
    '| proposal.atm-core-0001.from-1.0.0.to-1.1.0.atom.behavior-evolve | ATM-CORE-0001 | 1.0.0 → 1.1.0 | atom-bump | allPassed | approved |',
    ''
  ].join('\n'),
  'queue markdown projection must keep the audit table columns'
);

console.log(`[human-review:${mode}] ok (queue, decision log, schema, and exemplar triad verified)`);
