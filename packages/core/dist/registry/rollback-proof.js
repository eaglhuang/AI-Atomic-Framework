import { behaviorRollbackContract } from './rollback-types.js';
export function resolveRollbackBehavior(behaviorId) {
    return behaviorRollbackContract[behaviorId] ?? null;
}
export function validateRollbackProof(proof) {
    const issues = [];
    if (!proof.rollbackContractSymmetric) {
        issues.push('rollback contract is not symmetric for the provided behaviorId.');
    }
    if (!proof.hashesVerified.allVerified || !proof.hashesVerified.spec || !proof.hashesVerified.code || !proof.hashesVerified.test) {
        issues.push('spec/code/test hash verification failed.');
    }
    if (!proof.statusReverted) {
        issues.push('status was not reverted to the target version snapshot.');
    }
    if (!proof.semanticFingerprintReverted) {
        issues.push('semanticFingerprint was not reverted to the target version snapshot.');
    }
    if (proof.targetKind === 'map') {
        const memberProofs = proof.memberAtomProofs ?? [];
        if (memberProofs.length === 0) {
            issues.push('map rollback proof must include memberAtomProofs.');
        }
        if (memberProofs.some((entry) => !entry.matched)) {
            issues.push('at least one map member atom hash proof mismatched.');
        }
    }
    return {
        ok: issues.length === 0,
        issues
    };
}
export function createRollbackProof(options) {
    const identity = options.targetKind === 'atom' ? options.atomId : options.mapId;
    const proofId = `rollback-proof.${options.targetKind}.${String(identity)}.${options.fromVersion}.to.${options.toVersion}`;
    const verificationStatus = options.hashesVerified.allVerified && options.statusReverted && options.semanticFingerprintReverted
        ? 'passed'
        : 'failed';
    return {
        schemaId: 'atm.rollbackProof',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial rollback proof contract.'
        },
        proofId,
        targetKind: options.targetKind,
        atomId: options.atomId,
        mapId: options.mapId,
        fromVersion: options.fromVersion,
        toVersion: options.toVersion,
        behaviorId: options.behaviorId,
        reverseBehaviorId: options.reverseBehaviorId,
        rollbackContractSymmetric: true,
        hashesVerified: options.hashesVerified,
        verifiedAt: options.verifiedAt,
        statusReverted: options.statusReverted,
        semanticFingerprintReverted: options.semanticFingerprintReverted,
        verificationStatus,
        failureReason: verificationStatus === 'failed' ? 'Rollback proof checks failed.' : undefined,
        memberAtomProofs: options.memberAtomProofs,
        mapGeneratorProvenance: options.mapGeneratorProvenance,
        mapWorkbenchResolution: options.mapWorkbenchResolution
    };
}
