import type { AtomMapCuratorPatchDraftItem } from '../../core/src/upgrade/map-curator.ts';
import { createHumanReviewQueueRecord, type HumanReviewQueueRecord } from './queue.ts';

export interface AtomMapPatchReviewProposalSnapshot extends Readonly<Record<string, unknown>> {
  readonly schemaId: 'atm.upgradeProposal';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly proposalId: string;
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly lifecycleMode: 'evolution';
  readonly behaviorId: 'behavior.split';
  readonly target: {
    readonly kind: 'map';
    readonly mapId: string;
  };
  readonly decompositionDecision: 'split';
  readonly proposalSource: 'broker-split-suggestion';
  readonly targetSurface: 'atom-map';
  readonly reviewTemplate: 'review.template.split';
  readonly automatedGates: {
    readonly allPassed: true;
    readonly blockedGateNames: readonly [];
  };
  readonly humanReview: 'pending';
  readonly status: 'pending';
  readonly patchDraft: AtomMapCuratorPatchDraftItem;
  readonly inputs: readonly {
    readonly kind: 'evolution-evidence';
    readonly path: string;
    readonly schemaId: 'atm.atomMapCuratorReport';
    readonly reportId: string;
    readonly summary: string;
  }[];
  readonly proposedBy: string;
  readonly proposedAt: string;
}

export interface AtomMapPatchReviewProposalOptions {
  readonly generatedAt?: string;
  readonly proposedBy?: string;
  readonly baseMapVersion?: string;
  readonly reportPath?: string;
}

const DEFAULT_PROPOSED_BY = 'ATM Atom Map Curator';
const DEFAULT_REPORT_PATH = 'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json';

export function createAtomMapPatchReviewProposalSnapshot(
  patchDraft: AtomMapCuratorPatchDraftItem,
  options: AtomMapPatchReviewProposalOptions = {}
): AtomMapPatchReviewProposalSnapshot {
  const fromVersion = options.baseMapVersion ?? '0.1.0';
  const toVersion = bumpPatchVersion(fromVersion);
  const proposedAt = options.generatedAt ?? new Date().toISOString();
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  return {
    schemaId: 'atm.upgradeProposal',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Broker split suggestion promoted into a human-reviewable atom-map split plan.'
    },
    proposalId: `proposal.map-curator.patch.${sanitizeIdentifier(patchDraft.candidateId)}`,
    atomId: patchDraft.targetMapId,
    fromVersion,
    toVersion,
    lifecycleMode: 'evolution',
    behaviorId: 'behavior.split',
    target: {
      kind: 'map',
      mapId: patchDraft.targetMapId
    },
    decompositionDecision: 'split',
    proposalSource: 'broker-split-suggestion',
    targetSurface: 'atom-map',
    reviewTemplate: 'review.template.split',
    automatedGates: {
      allPassed: true,
      blockedGateNames: []
    },
    humanReview: 'pending',
    status: 'pending',
    patchDraft: cloneJson(patchDraft),
    inputs: [
      {
        kind: 'evolution-evidence',
        path: reportPath,
        schemaId: 'atm.atomMapCuratorReport',
        reportId: `map-curator-review.${sanitizeIdentifier(patchDraft.candidateId)}`,
        summary: `Curator patch draft derived from broker split suggestion ${patchDraft.candidateId}.`
      }
    ],
    proposedBy: options.proposedBy ?? DEFAULT_PROPOSED_BY,
    proposedAt
  };
}

export function createAtomMapPatchReviewQueueRecord(
  patchDraft: AtomMapCuratorPatchDraftItem,
  options: AtomMapPatchReviewProposalOptions = {}
): HumanReviewQueueRecord {
  return createHumanReviewQueueRecord(createAtomMapPatchReviewProposalSnapshot(patchDraft, options));
}

function bumpPatchVersion(version: string) {
  const parts = version.split('.').map((entry) => Number.parseInt(entry, 10));
  if (parts.length !== 3 || parts.some((entry) => Number.isNaN(entry))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  const [major, minor, patch] = parts;
  return `${major}.${minor}.${patch + 1}`;
}

function sanitizeIdentifier(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
