export type AtomRetirementStage = 'deprecated' | 'shadow-off' | 'legacy-retired';
export interface AtomDownstreamRef {
    refType: 'map-spec' | 'capsule-registry' | 'map-capsule' | 'consumer-adapter';
    sourceFile: string;
    mapId?: string;
}
export interface AtomRetirementProof {
    schemaId: 'atm.atomRetirementProof';
    proofId: string;
    atomId: string;
    retiredAt: string;
    retiredBy: string;
    stage: 'legacy-retired';
    activeDownstreamRefs: AtomDownstreamRef[];
    callerRiskCleared: boolean;
    shadowOffConfirmed: boolean;
    verificationStatus: 'passed' | 'failed';
    failureReason?: string;
    lineageRef: string;
}
export interface RetireProposalResult {
    ok: boolean;
    blockedReasons: string[];
    atomId: string;
    stage: AtomRetirementStage;
    activeDownstreamRefs: AtomDownstreamRef[];
    proof?: AtomRetirementProof;
}
export interface RetireApplyResult {
    ok: boolean;
    atomId: string;
    previousStage: AtomRetirementStage;
    newStage: AtomRetirementStage;
    proof?: AtomRetirementProof;
    lineageEvent?: object;
}
export declare function proposeRetire(repositoryRoot: string, atomId: string, options?: {
    shadowOffConfirmed?: boolean;
    retiredBy?: string;
}): RetireProposalResult;
export declare function applyRetire(repositoryRoot: string, atomId: string, targetStage: AtomRetirementStage, proof?: AtomRetirementProof): RetireApplyResult;
