import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type HumanReviewDecision = 'approve' | 'reject';
export type HumanReviewQueueStatus = 'pending' | 'blocked' | 'approved' | 'rejected';
export type HumanReviewDecompositionDecision = 'atom-bump' | 'atom-extract' | 'map-bump' | 'polymorphize' | 'extract-shared' | 'infect' | 'atomize';

export interface HumanReviewQueueMigration {
  readonly strategy: 'none' | 'additive' | 'breaking';
  readonly fromVersion: string | null;
  readonly notes: string;
}

export interface HumanReviewQueueReviewRecord {
  readonly decision: HumanReviewDecision;
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly decisionSnapshotHash: string;
  readonly evidenceId?: string;
}

export interface HumanReviewQueueAutomatedGatesSummary {
  readonly allPassed: boolean;
  readonly blockedGateNames: readonly string[];
}

export interface HumanReviewUpgradeProposalSnapshot {
  readonly proposalId: string;
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly decompositionDecision: HumanReviewDecompositionDecision;
  readonly automatedGates: HumanReviewQueueAutomatedGatesSummary;
  readonly status: HumanReviewQueueStatus;
  readonly proposedAt: string;
  readonly [key: string]: unknown;
}

export interface HumanReviewQueueRecord {
  readonly proposalId: string;
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly decompositionDecision: HumanReviewDecompositionDecision;
  readonly automatedGates: HumanReviewQueueAutomatedGatesSummary;
  readonly status: HumanReviewQueueStatus;
  readonly proposalSnapshotHash: string;
  readonly proposal: HumanReviewUpgradeProposalSnapshot;
  readonly queuedAt?: string;
  readonly review?: HumanReviewQueueReviewRecord;
}

export interface HumanReviewQueueDocument {
  readonly schemaId: 'atm.humanReviewQueue';
  readonly specVersion: '0.1.0';
  readonly migration: HumanReviewQueueMigration;
  readonly generatedAt: string;
  readonly entries: readonly HumanReviewQueueRecord[];
}

export interface HumanReviewQueueDocumentOptions {
  readonly generatedAt?: string;
  readonly migration?: Partial<HumanReviewQueueMigration>;
}

export interface HumanReviewQueueRecordOptions {
  readonly queuedAt?: string;
  readonly status?: HumanReviewQueueStatus;
  readonly review?: HumanReviewQueueReviewRecord;
}

export interface HumanReviewQueueValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface HumanReviewQueueValidationResult {
  readonly ok: boolean;
  readonly issues: readonly HumanReviewQueueValidationIssue[];
}

export const humanReviewQueuePackage = {
  packageName: '@ai-atomic-framework/plugin-human-review',
  packageRole: 'human-review-reference-plugin',
  packageVersion: '0.0.0'
} as const;

export function computeDecisionSnapshotHash(proposal: HumanReviewUpgradeProposalSnapshot | Readonly<Record<string, unknown>>) {
  return `sha256:${createHash('sha256').update(stableStringify(proposal), 'utf8').digest('hex')}`;
}

export function createHumanReviewQueueRecord(
  proposal: HumanReviewUpgradeProposalSnapshot | Readonly<Record<string, unknown>>,
  options: HumanReviewQueueRecordOptions = {}
): HumanReviewQueueRecord {
  const proposalSnapshot = cloneJson(proposal) as HumanReviewUpgradeProposalSnapshot;
  const proposalSnapshotHash = computeDecisionSnapshotHash(proposalSnapshot);
  const record: HumanReviewQueueRecord = {
    proposalId: proposalSnapshot.proposalId,
    atomId: proposalSnapshot.atomId,
    fromVersion: proposalSnapshot.fromVersion,
    toVersion: proposalSnapshot.toVersion,
    decompositionDecision: proposalSnapshot.decompositionDecision,
    automatedGates: {
      allPassed: proposalSnapshot.automatedGates.allPassed,
      blockedGateNames: [...proposalSnapshot.automatedGates.blockedGateNames]
    },
    status: options.status ?? proposalSnapshot.status,
    proposalSnapshotHash,
    proposal: proposalSnapshot,
    queuedAt: options.queuedAt ?? proposalSnapshot.proposedAt
  };

  return options.review
    ? {
      ...record,
      review: cloneJson(options.review) as HumanReviewQueueReviewRecord
    }
    : record;
}

export function createHumanReviewQueueDocument(entries: readonly HumanReviewQueueRecord[], options: HumanReviewQueueDocumentOptions = {}): HumanReviewQueueDocument {
  return {
    schemaId: 'atm.humanReviewQueue',
    specVersion: '0.1.0',
    migration: normalizeMigration(options.migration),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    entries: entries.map((entry) => cloneJson(entry) as HumanReviewQueueRecord)
  };
}

export function loadHumanReviewQueueDocument(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as HumanReviewQueueDocument | readonly HumanReviewQueueRecord[];
  return normalizeHumanReviewQueueDocument(parsed);
}

export function writeHumanReviewQueueDocument(filePath: string, document: HumanReviewQueueDocument) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return document;
}

export function normalizeHumanReviewQueueDocument(document: HumanReviewQueueDocument | readonly HumanReviewQueueRecord[]): HumanReviewQueueDocument {
  if (!isHumanReviewQueueDocument(document)) {
    return createHumanReviewQueueDocument(document);
  }
  return createHumanReviewQueueDocument(document.entries, {
    generatedAt: document.generatedAt,
    migration: document.migration
  });
}

export function findHumanReviewQueueRecord(document: HumanReviewQueueDocument, proposalId: string) {
  return document.entries.find((entry) => entry.proposalId === proposalId) ?? null;
}

export function replaceHumanReviewQueueRecord(document: HumanReviewQueueDocument, nextRecord: HumanReviewQueueRecord): HumanReviewQueueDocument {
  const entries = document.entries.map((entry) => entry.proposalId === nextRecord.proposalId ? cloneJson(nextRecord) as HumanReviewQueueRecord : entry);
  return createHumanReviewQueueDocument(entries, {
    generatedAt: new Date().toISOString(),
    migration: document.migration
  });
}

export function renderHumanReviewQueueMarkdown(document: HumanReviewQueueDocument) {
  const lines = [
    '# Upgrade Proposals',
    '',
    `Generated at ${document.generatedAt}`,
    '',
    '| proposalId | atomId | fromVersion → toVersion | decompositionDecision | automatedGates | status |',
    '| --- | --- | --- | --- | --- | --- |'
  ];

  for (const entry of document.entries) {
    lines.push(`| ${entry.proposalId} | ${entry.atomId} | ${entry.fromVersion} → ${entry.toVersion} | ${entry.decompositionDecision} | ${summarizeAutomatedGates(entry)} | ${entry.status} |`);
  }

  return `${lines.join('\n')}\n`;
}

export function validateHumanReviewQueueDocument(document: HumanReviewQueueDocument | readonly HumanReviewQueueRecord[]): HumanReviewQueueValidationResult {
  const normalized = normalizeHumanReviewQueueDocument(document);
  const issues: HumanReviewQueueValidationIssue[] = [];
  if (normalized.schemaId !== 'atm.humanReviewQueue') {
    issues.push({ path: '/schemaId', message: 'schemaId must be atm.humanReviewQueue.' });
  }
  if (normalized.specVersion !== '0.1.0') {
    issues.push({ path: '/specVersion', message: 'specVersion must be 0.1.0.' });
  }
  if (!Array.isArray(normalized.entries) || normalized.entries.length === 0) {
    issues.push({ path: '/entries', message: 'queue must contain at least one proposal record.' });
  }

  const seenProposalIds = new Set<string>();
  normalized.entries.forEach((entry, index) => {
    const recordIssues = validateHumanReviewQueueRecord(entry);
    for (const recordIssue of recordIssues.issues) {
      issues.push({ path: `/entries/${index}${recordIssue.path}`, message: recordIssue.message });
    }
    if (seenProposalIds.has(entry.proposalId)) {
      issues.push({ path: `/entries/${index}/proposalId`, message: `duplicate proposalId ${entry.proposalId}.` });
    }
    seenProposalIds.add(entry.proposalId);
  });

  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateHumanReviewQueueRecord(record: HumanReviewQueueRecord): HumanReviewQueueValidationResult {
  const issues: HumanReviewQueueValidationIssue[] = [];

  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      issues: [{ path: '', message: 'queue record must be an object.' }]
    };
  }

  if (!record.proposal || typeof record.proposal !== 'object') {
    issues.push({ path: '/proposal', message: 'queue record must include proposal snapshot.' });
  } else {
    const computedHash = computeDecisionSnapshotHash(record.proposal);
    if (record.proposalSnapshotHash !== computedHash) {
      issues.push({ path: '/proposalSnapshotHash', message: `proposal snapshot hash mismatch: expected ${computedHash}.` });
    }
    if (record.proposal.proposalId !== record.proposalId) {
      issues.push({ path: '/proposal/proposalId', message: 'proposalId must match the embedded proposal snapshot.' });
    }
  }

  if (record.status === 'approved' || record.status === 'rejected') {
    if (!record.review) {
      issues.push({ path: '/review', message: `review data is required when queue status is ${record.status}.` });
    } else {
      const expectedDecision = record.status === 'approved' ? 'approve' : 'reject';
      if (record.review.decision !== expectedDecision) {
        issues.push({ path: '/review/decision', message: `review decision must be ${expectedDecision} when queue status is ${record.status}.` });
      }
      if (record.review.decisionSnapshotHash !== record.proposalSnapshotHash) {
        issues.push({ path: '/review/decisionSnapshotHash', message: 'review hash must match the proposal snapshot hash.' });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function normalizeMigration(migration: Partial<HumanReviewQueueMigration> = {}): HumanReviewQueueMigration {
  return {
    strategy: migration.strategy ?? 'none',
    fromVersion: migration.fromVersion ?? null,
    notes: migration.notes ?? 'Initial human review queue contract.'
  };
}

function summarizeAutomatedGates(entry: HumanReviewQueueRecord) {
  if (entry.automatedGates.allPassed) {
    return 'allPassed';
  }
  const blocked = [...entry.automatedGates.blockedGateNames].filter(Boolean);
  return blocked.length > 0 ? `blocked: ${blocked.join(', ')}` : 'blocked';
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isHumanReviewQueueDocument(
  value: HumanReviewQueueDocument | readonly HumanReviewQueueRecord[]
): value is HumanReviewQueueDocument {
  return !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) {
      sorted[key] = sortValue(entry);
    }
  }
  return sorted;
}
