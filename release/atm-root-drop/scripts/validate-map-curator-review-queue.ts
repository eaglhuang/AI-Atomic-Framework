import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  createAtomMapPatchReviewProposalSnapshot,
  createAtomMapPatchReviewQueueRecord
} from '../packages/plugin-human-review/src/map-curator-bridge.ts';
import {
  createHumanReviewDecisionLog,
  createHumanReviewQueueDocument,
  type HumanReviewQueueRecord,
  validateHumanReviewDecisionLog,
  validateHumanReviewQueueDocument
} from '../packages/plugin-human-review/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[map-curator-review] ${message}`);
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

const requiredFiles = [
  'packages/core/src/upgrade/map-curator.ts',
  'packages/plugin-human-review/src/queue.ts',
  'packages/plugin-human-review/src/decision-log.ts',
  'packages/plugin-human-review/src/map-curator-bridge.ts',
  'schemas/human-review/decision.schema.json',
  'schemas/governance/evidence.schema.json',
  'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json'
];
for (const relativePath of requiredFiles) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const decisionSchema = readJson<Record<string, unknown>>('schemas/human-review/decision.schema.json');
const evidenceSchema = readJson<Record<string, unknown>>('schemas/governance/evidence.schema.json');
const curatorReport = readJson<{ patchDrafts: any[]; generatedAt: string }>('docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json');

check(Array.isArray(curatorReport.patchDrafts) && curatorReport.patchDrafts.length >= 1, 'curator report must expose patchDrafts');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(evidenceSchema, 'governance-evidence');
const validateDecision = ajv.compile(decisionSchema);

const queueRecords: HumanReviewQueueRecord[] = curatorReport.patchDrafts.map((patchDraft) =>
  createAtomMapPatchReviewQueueRecord(patchDraft, {
    generatedAt: curatorReport.generatedAt,
    reportPath: 'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json'
  })
);

const queueDocument = createHumanReviewQueueDocument(queueRecords, {
  generatedAt: curatorReport.generatedAt,
  migration: {
    strategy: 'none',
    fromVersion: null,
    notes: 'Broker split suggestion review queue.'
  }
});
const queueValidation = validateHumanReviewQueueDocument(queueDocument);
check(queueValidation.ok, `queue document must validate: ${JSON.stringify(queueValidation.issues)}`);

for (const record of queueDocument.entries) {
  check(record.decompositionDecision === 'split', `${record.proposalId} must use split decision`);
  check(record.atomId.startsWith('ATM-MAP-'), `${record.proposalId} must route review around target map id`);
  check(record.proposal.status === 'pending', `${record.proposalId} proposal snapshot must remain pending before review`);
  const patchDraft = (record.proposal as Record<string, any>).patchDraft;
  check(patchDraft?.draftKind === 'atom-map-patch', `${record.proposalId} must embed atom-map patch draft`);
}

const approvedLogs = queueDocument.entries.map((record) =>
  createHumanReviewDecisionLog({
    queueRecord: record,
    decision: 'approve',
    reason: 'Broker blocked a same-owner overlap, curator produced a bounded split draft, and the split plan is reviewable without mutating registry state.',
    decidedBy: 'ATM Curator Reviewer',
    decidedAt: '2026-06-22T05:10:00.000Z',
    queuePath: 'docs/reports/split-suggestion-evidence/split-suggestion-review-queue.json',
    projectionPath: 'docs/reports/split-suggestion-evidence/split-suggestion-review-queue.md',
    evidenceId: `human-review.${record.proposalId}.approve`
  })
);

for (const log of approvedLogs) {
  const validation = validateHumanReviewDecisionLog(log);
  check(validation.ok, `decision log ${log.proposalId} must validate semantically: ${JSON.stringify(validation.issues)}`);
  check(validateDecision(log) === true, `decision log ${log.proposalId} must validate against schema: ${JSON.stringify(validateDecision.errors)}`);
  check(log.queueRecord.status === 'approved', `${log.proposalId} queue record must be approved after review`);
  check(log.queueRecord.proposal.decompositionDecision === 'split', `${log.proposalId} approved proposal must preserve split decision`);
}

const proposalSnapshot = createAtomMapPatchReviewProposalSnapshot(curatorReport.patchDrafts[0], {
  generatedAt: curatorReport.generatedAt,
  reportPath: 'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json'
});
check(proposalSnapshot.patchDraft.ownerAtomId === curatorReport.patchDrafts[0].ownerAtomId, 'proposal snapshot must preserve owner atom id');
check(proposalSnapshot.patchDraft.operations.length >= 3, 'proposal snapshot must preserve split patch operations');

console.log(`[map-curator-review] ok (queue bridge, split decision schema, and curator-approved decision logs verified for ${approvedLogs.length} patch draft(s))`);
