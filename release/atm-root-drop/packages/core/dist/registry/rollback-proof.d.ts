import { type RollbackHashesVerified, type RollbackMapWorkbenchResolution, type RollbackMemberAtomProof, type RollbackProof, type RollbackProofValidationResult, type RollbackTargetKind } from './rollback-types.ts';
export declare function resolveRollbackBehavior(behaviorId: string): "behavior.rollback-evolve" | "behavior.rollback-merge" | "behavior.rollback-atomize" | "behavior.rollback-infect";
export declare function validateRollbackProof(proof: RollbackProof): RollbackProofValidationResult;
export declare function createRollbackProof(options: {
    readonly targetKind: RollbackTargetKind;
    readonly atomId?: string;
    readonly mapId?: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly behaviorId: string;
    readonly reverseBehaviorId: string;
    readonly hashesVerified: RollbackHashesVerified;
    readonly verifiedAt: string;
    readonly statusReverted: boolean;
    readonly semanticFingerprintReverted: boolean;
    readonly memberAtomProofs?: readonly RollbackMemberAtomProof[];
    readonly mapGeneratorProvenance?: boolean;
    readonly mapWorkbenchResolution?: RollbackMapWorkbenchResolution;
}): RollbackProof;
