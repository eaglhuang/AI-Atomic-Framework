import type { RegistryDocument } from '../index.ts';

export const behaviorRollbackContract = Object.freeze({
  'behavior.evolve': 'behavior.rollback-evolve',
  'behavior.merge': 'behavior.rollback-merge',
  'behavior.atomize': 'behavior.rollback-atomize',
  'behavior.infect': 'behavior.rollback-infect'
} as const);

export type RollbackTargetKind = 'atom' | 'map';

export interface RollbackHashesVerified {
  readonly spec: boolean;
  readonly code: boolean;
  readonly test: boolean;
  readonly allVerified: boolean;
}

export interface RollbackMemberAtomProof {
  readonly atomId: string;
  readonly version: string;
  readonly expected: {
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
  };
  readonly actual: {
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
  };
  readonly matched: boolean;
}

export interface RollbackMapWorkbenchResolution {
  readonly canonicalPath: string;
  readonly legacyPath: string;
  readonly selectedPath: string;
  readonly selectedSource: 'canonical' | 'legacy';
}

export interface RollbackProof {
  readonly schemaId: 'atm.rollbackProof';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly proofId: string;
  readonly targetKind: RollbackTargetKind;
  readonly atomId?: string;
  readonly mapId?: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly behaviorId: string;
  readonly reverseBehaviorId: string;
  readonly rollbackContractSymmetric: boolean;
  readonly hashesVerified: RollbackHashesVerified;
  readonly verifiedAt: string;
  readonly statusReverted: boolean;
  readonly semanticFingerprintReverted: boolean;
  readonly verificationStatus: 'passed' | 'failed';
  readonly failureReason?: string;
  readonly memberAtomProofs?: readonly RollbackMemberAtomProof[];
  readonly mapGeneratorProvenance?: boolean;
  readonly mapWorkbenchResolution?: RollbackMapWorkbenchResolution;
}

export interface RollbackProofValidationResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface ResolveMapWorkbenchPathOptions {
  readonly repositoryRoot: string;
  readonly mapId: string;
  readonly mapOwner?: string;
}

export interface ApplyRegistryRollbackOptions {
  readonly registryDocument: RegistryDocument;
  readonly targetKind: RollbackTargetKind;
  readonly atomId?: string;
  readonly mapId?: string;
  readonly toVersion: string;
  readonly behaviorId: string;
  readonly repositoryRoot: string;
  readonly mapOwner?: string;
  readonly verifiedAt?: string;
}

export interface ApplyRegistryRollbackResult {
  readonly updatedRegistryDocument: RegistryDocument;
  readonly proof: RollbackProof;
}

