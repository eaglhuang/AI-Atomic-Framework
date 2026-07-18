import type { ReleasePublicationReadiness, ReleasePublicationReceipt } from './types.ts';
export declare function inspectReleasePublicationReadiness(input: {
    readonly cwd: string;
    readonly stewardActorId: string;
    readonly sealedSourceCommit?: string | null;
    readonly artifactPath?: string | null;
    readonly artifactSha256?: string | null;
    readonly publicationReceipt?: string | null;
    readonly dirtyFiles?: readonly string[] | null;
    readonly activeCaptains?: readonly string[] | null;
    readonly ownershipAgreement?: string | null;
}): ReleasePublicationReadiness;
export declare function assertReleasePublicationReadiness(report: ReleasePublicationReadiness): void;
export declare function createReleasePublicationReceipt(input: {
    readonly stewardActorId: string;
    readonly sealedSourceCommit: string | null;
    readonly artifactPath: string;
    readonly artifactSha256: string;
    readonly publicationReceipt: string;
    readonly generatedAt?: string;
}): ReleasePublicationReceipt;
export declare function runNpmBuildAfterAdmission(cwd: string): import("./types.ts").CommandRunRecord;
