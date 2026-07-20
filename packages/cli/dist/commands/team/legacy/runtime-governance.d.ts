import { type TeamClosureAttestationEvidence } from '../../evidence.ts';
import type { TeamProviderSelectionConfig, TeamRoleProviderOverride } from '../../../../../core/src/team-runtime/provider-selection.ts';
import type { PermissionLease, ReviewerIdentity, TeamClosureAttestationInput, TeamRecipe, TeamRuntimeContract, TeamRuntimeMode } from './types.ts';
export declare function buildTeamRuntimeContract(input: {
    runtimeMode?: unknown;
    runtimeLanguage?: unknown;
    runtimeAdapterId?: unknown;
    providerId?: unknown;
    sdkId?: unknown;
    modelId?: unknown;
    roleName?: unknown;
    selectionConfig?: TeamProviderSelectionConfig | null;
    editorBridgeDisabled?: unknown;
    recipe?: TeamRecipe;
    allowedFiles?: readonly string[];
    permissionLeases?: readonly PermissionLease[];
    evidenceRequired?: unknown;
}): TeamRuntimeContract;
export declare function buildTeamClosureAttestation(input: TeamClosureAttestationInput): TeamClosureAttestationEvidence;
export declare function normalizeTeamRuntimeMode(value: unknown): TeamRuntimeMode;
export declare function normalizeOptionalRuntimeString(value: unknown): string | null;
export declare function buildCliGlobalProviderDefault(options: Record<string, unknown>): Partial<TeamRoleProviderOverride> | null;
export declare function evaluateReviewerIndependence(input: {
    implementer: ReviewerIdentity;
    reviewer: ReviewerIdentity;
    policy: 'different-provider' | 'different-model-family' | 'different-certification';
}): {
    schemaId: string;
    ok: boolean;
    policy: "different-provider" | "different-model-family" | "different-certification";
    checks: {
        differentProvider: boolean;
        differentModelFamily: boolean;
        differentCertification: boolean;
    };
    reason: string;
};
export declare function buildReviewAgentSignature(input: {
    taskId: string;
    reviewer: ReviewerIdentity;
    implementer: ReviewerIdentity;
    reviewedDiffHash: string;
    policy: 'different-provider' | 'different-model-family' | 'different-certification';
    findings?: readonly string[];
}): {
    schemaId: string;
    taskId: string;
    signatureStatus: string;
    permission: string | null;
    reviewer: {
        providerId: string;
        modelId: string;
        modelCertificationId: string | null;
    };
    implementer: {
        providerId: string;
        modelId: string;
        modelCertificationId: string | null;
    };
    modelCertificationId: string | null;
    reviewerIndependencePolicy: "different-provider" | "different-model-family" | "different-certification";
    independence: {
        schemaId: string;
        ok: boolean;
        policy: "different-provider" | "different-model-family" | "different-certification";
        checks: {
            differentProvider: boolean;
            differentModelFamily: boolean;
            differentCertification: boolean;
        };
        reason: string;
    };
    reviewedDiffHash: string;
    findings: string[];
    earlyWarning: {
        category: string;
        finding: string;
    }[];
};
export declare function evaluateReviewQuorum(input: {
    signatures: readonly ReturnType<typeof buildReviewAgentSignature>[];
    requiredFormalSignatures: number;
}): {
    schemaId: string;
    ok: boolean;
    requiredFormalSignatures: number;
    formalSignatureCount: number;
    advisoryNoteCount: number;
    conflicts: string[];
    escalationTarget: string | null;
    reason: string;
};
