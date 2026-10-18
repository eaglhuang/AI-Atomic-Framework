import { existsSync } from 'node:fs';
import path from 'node:path';
import { validatePropagationReport } from '../../test-runner/propagation.js';
import { validateRetirementProof } from '../retirement-proof.js';
import { validateRollbackProof } from '../rollback-proof.js';
import { readJson } from './support.js';
import { asRecord } from './types.js';
export function loadEvidenceDocuments(repositoryRoot, evidenceRefs) {
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
                document: asRecord(readJson(absolutePath)),
                error: null
            };
        }
        catch (error) {
            return {
                path: evidenceRef,
                absolutePath,
                document: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
}
export function findMapEquivalenceEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => entry.document?.schemaId === 'atm.mapEquivalenceReport'
        && entry.document?.mapId === mapId
        && entry.document?.passed === true);
    return {
        passed: Boolean(match),
        path: match?.path ?? null
    };
}
export function findPropagationEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => safeValidatePropagationEvidence(entry.document, mapId).ok === true);
    return {
        passed: Boolean(match),
        path: match?.path ?? null
    };
}
export function findReviewAdvisoryEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => {
        const record = asRecord(entry.document);
        if (!record) {
            return false;
        }
        const advisoryTarget = asRecord(record.target) ?? null;
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
export function findHumanReviewEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => {
        const record = asRecord(entry.document);
        if (!record) {
            return false;
        }
        const queueRecord = asRecord(record.queueRecord);
        const queueProposal = asRecord(queueRecord?.proposal);
        const queueTarget = asRecord(queueProposal?.target);
        const proposal = asRecord(record.proposal);
        const proposalTarget = asRecord(proposal?.target);
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
export function findRollbackProofEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => safeValidateRollbackEvidence(entry.document, mapId).ok === true);
    return {
        passed: Boolean(match),
        path: match?.path ?? null
    };
}
export function findRetirementProofEvidence(mapId, evidenceDocuments) {
    const match = evidenceDocuments.find((entry) => safeValidateRetirementEvidence(entry.document, mapId).ok === true);
    return {
        passed: Boolean(match),
        path: match?.path ?? null
    };
}
function safeValidatePropagationEvidence(document, mapId) {
    try {
        const result = validatePropagationReport(asRecord(document), { mapId });
        return {
            ok: result.ok,
            issues: result.issues ? [...result.issues] : undefined
        };
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
function safeValidateRollbackEvidence(document, mapId) {
    const record = asRecord(document);
    try {
        if (record?.schemaId !== 'atm.rollbackProof' || record?.targetKind !== 'map' || record?.mapId !== mapId || record?.verificationStatus !== 'passed') {
            return { ok: false, issues: ['rollback proof does not match target map or did not pass'] };
        }
        const result = validateRollbackProof(record);
        return {
            ok: result.ok,
            issues: [...result.issues]
        };
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
function safeValidateRetirementEvidence(document, mapId) {
    const record = asRecord(document);
    try {
        if (record?.schemaId !== 'atm.retirementProof' || record?.mapId !== mapId || record?.verificationStatus !== 'passed') {
            return { ok: false, issues: ['retirement proof does not match target map or did not pass'] };
        }
        const result = validateRetirementProof(record);
        return {
            ok: result.ok,
            issues: [...result.issues]
        };
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
