import { type FileDescriptor, type FileMutationAdapter, type MigrationRecord, type MutationRequest } from './types.js';
export type CompositionMemberVerdict = 'selected' | 'skipped' | 'blocked';
export interface CompositionMemberAttribution {
    readonly requestId: string;
    readonly actorId: string;
    readonly taskId: string | null;
    readonly transactionIds: readonly string[];
    readonly filePath: string;
    readonly adapterId: string | null;
    readonly verdict: CompositionMemberVerdict;
    readonly reason: string;
}
export interface CompositionFileSlice {
    readonly filePath: string;
    readonly adapterId: string;
    readonly baseHash: string;
    readonly outputHash: string;
    readonly selectedRequestIds: readonly string[];
}
export interface CompositionRollbackReceipt {
    readonly strategy: 'discard-temp-tree';
    readonly tempTreeMutation: false;
    readonly liveWorktreeMutation: false;
    readonly returnedQueueRequestIds: readonly string[];
}
export interface CompositionSerializabilityProof {
    readonly legalSerialOrder: readonly string[];
    readonly permutationStable: boolean;
    readonly equivalentOutputHash: string;
    readonly checkedPermutationCount: number;
}
export interface TransactionalCompositionPlan {
    readonly schemaId: 'atm.compositionPlan.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly planId: string;
    readonly baseTree: 'in-memory';
    readonly outputTree: 'in-memory';
    readonly bounded: true;
    readonly selectedRequestIds: readonly string[];
    readonly skippedRequestIds: readonly string[];
    readonly blockedRequestIds: readonly string[];
    readonly fileSlices: readonly CompositionFileSlice[];
    readonly memberAttribution: readonly CompositionMemberAttribution[];
    readonly serializabilityProof: CompositionSerializabilityProof;
    readonly rollback: CompositionRollbackReceipt;
    readonly validatorRefs: readonly string[];
}
export interface TransactionalComposeResult {
    readonly ok: boolean;
    readonly plan: TransactionalCompositionPlan;
    readonly outputFiles: readonly FileDescriptor[];
}
export declare function composeTransactionalMutations(input: {
    readonly files: readonly FileDescriptor[];
    readonly requests: readonly MutationRequest[];
    readonly validators?: readonly string[];
    readonly adapters?: readonly FileMutationAdapter[];
    readonly maxPermutationChecks?: number;
}): TransactionalComposeResult;
