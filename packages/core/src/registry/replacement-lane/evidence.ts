import { existsSync } from 'node:fs';
import path from 'node:path';
import { validatePropagationReport } from '../../test-runner/propagation.ts';
import { validateRetirementProof } from '../retirement-proof.ts';
import { validateRollbackProof } from '../rollback-proof.ts';
import type { RollbackProof } from '../rollback-types.ts';
import { readJson } from './support.ts';
import type {
  EvidenceCheckResult,
  EvidenceDocumentRecord,
  LoadedEvidenceDocument,
  ReplacementLaneValidationResult
} from './types.ts';
import { asRecord } from './types.ts';

export function loadEvidenceDocuments(repositoryRoot: string, evidenceRefs: readonly string[]): LoadedEvidenceDocument[] {
  return evidenceRefs.map((evidenceRef) => {
    const absolutePath = path.isAbsolute(evidenceRef) ? evidenceRef : path.join(repositoryRoot, evidenceRef);
    if (!existsSync(absolutePath)) {
      return {
        path: evidenceRef,
        absolutePath,
        document: null,
        error: 'evidence file was not found'
      };
    }
    try {
      return {
        path: evidenceRef,
        absolutePath,
        document: asRecord<Record<string, unknown>>(readJson(absolutePath)),
        error: null
      };
    } catch (error) {
      return {
        path: evidenceRef,
        absolutePath,
        document: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

export function findMapEquivalenceEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => entry.document?.schemaId === 'atm.mapEquivalenceReport'
    && entry.document?.mapId === mapId
    && entry.document?.passed === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

export function findPropagationEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => safeValidatePropagationEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

export function findReviewAdvisoryEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => {
    const record = asRecord<EvidenceDocumentRecord>(entry.document);
    if (!record) {
      return false;
    }
    const advisoryTarget = asRecord<NonNullable<EvidenceDocumentRecord['target']>>(record.target) ?? null;
    const targetMatches = advisoryTarget == null
      || advisoryTarget.kind === 'proposal'
      || advisoryTarget.id == null
      || advisoryTarget.id === mapId;
    return targetMatches
      && record.advisoryUnavailable !== true
      && (record.status === 'ok' || record.status === 'warn')
      && typeof record.reportId === 'string';
  });
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

export function findHumanReviewEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => {
    const record = asRecord<EvidenceDocumentRecord>(entry.document);
    if (!record) {
      return false;
    }
    const queueRecord = asRecord<NonNullable<EvidenceDocumentRecord['queueRecord']>>(record.queueRecord);
    const queueProposal = asRecord<NonNullable<NonNullable<EvidenceDocumentRecord['queueRecord']>['proposal']>>(queueRecord?.proposal);
    const queueTarget = asRecord<NonNullable<NonNullable<NonNullable<EvidenceDocumentRecord['queueRecord']>['proposal']>['target']>>(queueProposal?.target);
    const proposal = asRecord<NonNullable<EvidenceDocumentRecord['proposal']>>(record.proposal);
    const proposalTarget = asRecord<NonNullable<NonNullable<EvidenceDocumentRecord['proposal']>['target']>>(proposal?.target);
    const reviewedMapId = queueTarget?.mapId ?? proposalTarget?.mapId ?? null;
    return record.schemaId === 'atm.humanReviewDecision'
      && record.decision === 'approve'
      && queueRecord?.status === 'approved'
      && (reviewedMapId == null || reviewedMapId === mapId);
  });
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

export function findRollbackProofEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => safeValidateRollbackEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

export function findRetirementProofEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult {
  const match = evidenceDocuments.find((entry) => safeValidateRetirementEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function safeValidatePropagationEvidence(document: unknown, mapId: string): ReplacementLaneValidationResult {
  try {
    const result = validatePropagationReport(asRecord<Record<string, unknown>>(document), { mapId });
    return {
      ok: result.ok,
      issues: result.issues ? [...result.issues] : undefined
    };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRollbackEvidence(document: unknown, mapId: string): ReplacementLaneValidationResult {
  const record = asRecord<Record<string, unknown>>(document);
  try {
    if (record?.schemaId !== 'atm.rollbackProof' || record?.targetKind !== 'map' || record?.mapId !== mapId || record?.verificationStatus !== 'passed') {
      return { ok: false, issues: ['rollback proof does not match target map or did not pass'] };
    }
    const result = validateRollbackProof(record as unknown as RollbackProof);
    return {
      ok: result.ok,
      issues: [...result.issues]
    };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRetirementEvidence(document: unknown, mapId: string): ReplacementLaneValidationResult {
  const record = asRecord<Record<string, unknown>>(document);
  try {
    if (record?.schemaId !== 'atm.retirementProof' || record?.mapId !== mapId || record?.verificationStatus !== 'passed') {
      return { ok: false, issues: ['retirement proof does not match target map or did not pass'] };
    }
    const result = validateRetirementProof(record);
    return {
      ok: result.ok,
      issues: [...result.issues]
    };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}
